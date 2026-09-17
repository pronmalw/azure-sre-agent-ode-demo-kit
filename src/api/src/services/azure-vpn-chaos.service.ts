import { DefaultAzureCredential, TokenCredential } from '@azure/identity';
import { azureConfig, isAzureVpnConfigured } from '../config';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export type VpnTunnelStatus = 'connected' | 'degraded' | 'down';

export interface VpnConnectionReading {
  status: VpnTunnelStatus;
  connectionStatus: string;
  egressBytes: number;
  ingressBytes: number;
  packetLossPercent: number;
  source: 'azure' | 'simulated';
  lastUpdated: string;
}

const BROKEN_SHARED_KEY = 'chaos-injected-mismatched-psk-0000';
const POLL_INTERVAL_MS = 15_000;
const ARM_BASE = 'https://management.azure.com';
const ARM_API_VERSION = '2023-09-01';
const ARM_SCOPE = 'https://management.azure.com/.default';

interface ArmConnection {
  properties?: {
    connectionStatus?: string;
    egressBytesTransferred?: number;
    ingressBytesTransferred?: number;
  };
}

/**
 * Breaks and heals a real Azure VPN Gateway site-to-site connection.
 *
 * Breaking is a two-step operation: rotating the IPsec pre-shared key on one end
 * alone is not enough, because an already-established IKE security association
 * keeps carrying traffic until its lifetime expires. We therefore rotate the key
 * and then force a connection reset, so renegotiation happens immediately and
 * fails on the key mismatch. The tunnel really drops and Azure Monitor emits
 * genuine VPN Gateway signals for the Azure SRE Agent to diagnose.
 *
 * Calls go straight to ARM over REST rather than through @azure/arm-network,
 * whose connection deserializer throws on gateways that have no
 * autoScaleConfiguration.
 */
export class AzureVpnChaosService {
  private credential: TokenCredential | null = null;
  private cachedToken: { token: string; expiresOnTimestamp: number } | null = null;
  private lastReading: VpnConnectionReading | null = null;
  private lastPolledAt = 0;
  private inflightPoll: Promise<VpnConnectionReading> | null = null;
  private lastErrorMessage = '';
  private previousBytes: { egress: number; ingress: number; at: number } | null = null;

  isEnabled(): boolean {
    return isAzureVpnConfigured();
  }

  async breakTunnel(): Promise<VpnConnectionReading> {
    await this.setSharedKey(BROKEN_SHARED_KEY);
    // Force IKE renegotiation so the mismatch takes effect now rather than at rekey.
    await this.resetConnection();
    return this.markExpected('down');
  }

  async healTunnel(): Promise<VpnConnectionReading> {
    await this.setSharedKey(azureConfig.vpnHealthySharedKey);
    await this.resetConnection();
    return this.markExpected('connected');
  }

  /**
   * Returns the live tunnel state, cached for POLL_INTERVAL_MS so a busy request
   * path never blocks on an ARM round trip.
   */
  async getReading(): Promise<VpnConnectionReading | null> {
    if (!this.isEnabled()) {
      return null;
    }

    const now = Date.now();
    if (this.lastReading && now - this.lastPolledAt < POLL_INTERVAL_MS) {
      return this.lastReading;
    }

    if (this.inflightPoll) {
      return this.lastReading;
    }

    this.inflightPoll = this.pollConnection()
      .then((reading) => {
        this.lastReading = reading;
        this.lastPolledAt = Date.now();
        this.lastErrorMessage = '';
        return reading;
      })
      .catch((error) => {
        const message = (error as Error).message;
        // Throttle: the tunnel can legitimately be absent while it provisions,
        // and getReading() runs on every telemetry snapshot.
        if (message !== this.lastErrorMessage) {
          console.error('[vpn-chaos] failed to read VPN connection state:', message);
          this.lastErrorMessage = message;
        }

        const fallback: VpnConnectionReading = this.lastReading ?? {
          status: 'degraded',
          connectionStatus: 'Unknown',
          egressBytes: 0,
          ingressBytes: 0,
          packetLossPercent: 0,
          source: 'azure',
          lastUpdated: new Date().toISOString(),
        };
        // Cache the fallback too, otherwise every caller re-triggers a poll.
        this.lastReading = fallback;
        this.lastPolledAt = Date.now();
        return fallback;
      })
      .finally(() => {
        this.inflightPoll = null;
      });

    return this.lastReading ?? this.inflightPoll;
  }

  getCachedReading(): VpnConnectionReading | null {
    return this.lastReading;
  }

  private get connectionId(): string {
    return `/subscriptions/${azureConfig.subscriptionId}/resourceGroups/${azureConfig.resourceGroup}/providers/Microsoft.Network/connections/${azureConfig.vpnConnectionName}`;
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresOnTimestamp - now > 60_000) {
      return this.cachedToken.token;
    }

    if (!this.credential) {
      this.credential = new DefaultAzureCredential();
    }

    const token = await this.credential.getToken(ARM_SCOPE);
    if (!token) {
      throw new Error('Failed to acquire an ARM access token.');
    }

    this.cachedToken = { token: token.token, expiresOnTimestamp: token.expiresOnTimestamp };
    return token.token;
  }

  private async armRequest(method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown): Promise<unknown> {
    if (!this.isEnabled()) {
      throw new Error('Azure VPN chaos is not configured.');
    }

    const token = await this.getToken();
    const response = await fetch(`${ARM_BASE}${path}?api-version=${ARM_API_VERSION}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ARM ${method} ${path} failed with ${response.status}: ${text.slice(0, 300)}`);
    }

    if (response.status === 202 || response.headers.get('content-length') === '0') {
      return {};
    }

    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }

  private async setSharedKey(sharedKey: string): Promise<void> {
    await this.armRequest('PUT', `${this.connectionId}/sharedkey`, { value: sharedKey });
    await this.waitUntilIdle();
  }

  /**
   * Rotating the pre-shared key alone does not drop traffic: the already
   * established IKE security association keeps forwarding packets until it
   * rekeys. Resetting the connection forces renegotiation, which then fails
   * against the mismatched key and produces a genuine NotConnected tunnel.
   *
   * ARM rejects overlapping writes on the same connection with 409
   * AnotherOperationInProgress, so wait for the gateway to go idle first and
   * still retry if another operation slips in.
   */
  private async resetConnection(): Promise<void> {
    const maxAttempts = 6;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await this.waitUntilIdle();

      try {
        await this.armRequest('POST', `${this.connectionId}/resetconnection`);
        await this.waitUntilIdle();
        return;
      } catch (error) {
        const message = (error as Error).message;
        if (!message.includes('failed with 409') || attempt === maxAttempts) {
          throw error;
        }

        console.warn(`[vpn-chaos] reset blocked by a concurrent ARM operation, retry ${attempt}/${maxAttempts}.`);
        await sleep(15_000);
      }
    }
  }

  /**
   * Blocks until the connection resource leaves the Updating/Deleting state.
   * Without this the follow-up call races the previous one and fails with 409,
   * which previously meant the tunnel never actually went down.
   */
  private async waitUntilIdle(timeoutMs = 240_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        const connection = (await this.armRequest('GET', this.connectionId)) as {
          properties?: { provisioningState?: string };
        };
        const state = connection.properties?.provisioningState;

        if (!state || state === 'Succeeded' || state === 'Failed') {
          return;
        }
      } catch {
        // Transient read failures should not abort the chaos action.
        return;
      }

      await sleep(5_000);
    }
  }

  private markExpected(expected: VpnTunnelStatus): VpnConnectionReading {
    // Invalidate the cache so the next telemetry snapshot re-reads Azure, but
    // report the expected state immediately so the UI reacts without delay.
    const reading: VpnConnectionReading = {
      status: expected,
      connectionStatus: expected === 'down' ? 'NotConnected' : 'Connecting',
      egressBytes: 0,
      ingressBytes: 0,
      packetLossPercent: expected === 'down' ? 100 : 0,
      source: 'azure',
      lastUpdated: new Date().toISOString(),
    };
    this.lastReading = reading;
    this.lastPolledAt = Date.now();
    this.previousBytes = null;
    return reading;
  }

  private async pollConnection(): Promise<VpnConnectionReading> {
    const connection = (await this.armRequest('GET', this.connectionId)) as ArmConnection;
    const properties = connection.properties ?? {};

    const connectionStatus = properties.connectionStatus ?? 'Unknown';
    const egressBytes = Number(properties.egressBytesTransferred ?? 0);
    const ingressBytes = Number(properties.ingressBytesTransferred ?? 0);

    let status: VpnTunnelStatus;
    if (connectionStatus === 'Connected') {
      status = 'connected';
    } else if (connectionStatus === 'Connecting') {
      status = 'degraded';
    } else {
      status = 'down';
    }

    return {
      status,
      connectionStatus,
      egressBytes,
      ingressBytes,
      packetLossPercent: this.estimatePacketLoss(status, egressBytes, ingressBytes),
      source: 'azure',
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Azure exposes cumulative byte counters on the connection rather than a loss
   * percentage. We derive loss from the delta between bytes sent and bytes
   * received since the previous poll: traffic pushed into a dead or flapping
   * tunnel never comes back, which is what packet loss looks like.
   */
  private estimatePacketLoss(status: VpnTunnelStatus, egressBytes: number, ingressBytes: number): number {
    const now = Date.now();
    const previous = this.previousBytes;
    this.previousBytes = { egress: egressBytes, ingress: ingressBytes, at: now };

    if (status === 'down') {
      return 100;
    }

    if (!previous) {
      return status === 'degraded' ? 45 : 0;
    }

    const egressDelta = Math.max(0, egressBytes - previous.egress);
    const ingressDelta = Math.max(0, ingressBytes - previous.ingress);

    if (egressDelta === 0) {
      return status === 'degraded' ? 45 : 0;
    }

    const lost = Math.max(0, egressDelta - ingressDelta);
    return Math.min(100, Math.round((lost / egressDelta) * 100));
  }
}

let vpnChaosSingleton: AzureVpnChaosService | undefined;

export const getAzureVpnChaosService = (): AzureVpnChaosService => {
  if (!vpnChaosSingleton) {
    vpnChaosSingleton = new AzureVpnChaosService();
  }

  return vpnChaosSingleton;
};
