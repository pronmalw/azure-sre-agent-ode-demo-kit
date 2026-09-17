import { DefaultAzureCredential } from '@azure/identity';
import { NetworkManagementClient } from '@azure/arm-network';
import { azureConfig, isAzureVpnConfigured } from '../config';

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

/**
 * Breaks and heals a real Azure VPN Gateway site-to-site connection by rotating
 * the IPsec pre-shared key on one end of the tunnel only. The key mismatch causes
 * IKE negotiation to fail, the tunnel drops for real, and Azure Monitor emits
 * genuine TunnelAverageBandwidth / TunnelEgressPacketDropCount signals that the
 * Azure SRE Agent can observe.
 */
export class AzureVpnChaosService {
  private client: NetworkManagementClient | null = null;
  private lastReading: VpnConnectionReading | null = null;
  private lastPolledAt = 0;
  private inflightPoll: Promise<VpnConnectionReading> | null = null;
  private lastErrorMessage = '';
  private previousBytes: { egress: number; ingress: number; at: number } | null = null;

  isEnabled(): boolean {
    return isAzureVpnConfigured();
  }

  async breakTunnel(): Promise<VpnConnectionReading> {
    return this.setSharedKey(BROKEN_SHARED_KEY, 'down');
  }

  async healTunnel(): Promise<VpnConnectionReading> {
    return this.setSharedKey(azureConfig.vpnHealthySharedKey, 'connected');
  }

  /**
   * Returns the live tunnel state, cached for POLL_INTERVAL_MS so that a busy
   * request path never blocks on an ARM round trip.
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
        // and getReading() is called from every telemetry snapshot.
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

    // First ever call has no cached value, so wait for it; later calls return stale-while-revalidate.
    return this.lastReading ?? this.inflightPoll;
  }

  getCachedReading(): VpnConnectionReading | null {
    return this.lastReading;
  }

  private getClient(): NetworkManagementClient {
    if (!this.client) {
      this.client = new NetworkManagementClient(new DefaultAzureCredential(), azureConfig.subscriptionId);
    }

    return this.client;
  }

  private async setSharedKey(sharedKey: string, expected: VpnTunnelStatus): Promise<VpnConnectionReading> {
    if (!this.isEnabled()) {
      throw new Error('Azure VPN chaos is not configured.');
    }

    const client = this.getClient();
    await client.virtualNetworkGatewayConnections.beginSetSharedKeyAndWait(
      azureConfig.resourceGroup,
      azureConfig.vpnConnectionName,
      { value: sharedKey },
    );

    // Invalidate the cache so the next telemetry snapshot re-reads Azure.
    this.lastPolledAt = 0;
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
    return reading;
  }

  private async pollConnection(): Promise<VpnConnectionReading> {
    const client = this.getClient();
    const connection = await client.virtualNetworkGatewayConnections.get(
      azureConfig.resourceGroup,
      azureConfig.vpnConnectionName,
    );

    const connectionStatus = connection.connectionStatus ?? 'Unknown';
    const egressBytes = Number(connection.egressBytesTransferred ?? 0);
    const ingressBytes = Number(connection.ingressBytesTransferred ?? 0);

    let status: VpnTunnelStatus;
    if (connectionStatus === 'Connected') {
      status = 'connected';
    } else if (connectionStatus === 'Connecting') {
      status = 'degraded';
    } else {
      status = 'down';
    }

    const packetLossPercent = this.estimatePacketLoss(status, egressBytes, ingressBytes);

    return {
      status,
      connectionStatus,
      egressBytes,
      ingressBytes,
      packetLossPercent,
      source: 'azure',
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Azure exposes cumulative byte counters on the connection rather than a loss
   * percentage. We derive loss from the delta between egress sent and ingress
   * received since the previous poll: traffic pushed into a dead or flapping
   * tunnel never comes back, which is exactly what packet loss looks like.
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
