import { v4 as uuid } from 'uuid';
import { ChaosState, DEFAULT_CHAOS_STATE, DemoEvent } from '../types';
import { getTelemetryService } from './telemetry.service';
import { getAzureVpnChaosService } from './azure-vpn-chaos.service';
import { getCpuLoadService } from './cpu-load.service';
import { getCosmosThrottleService } from './cosmos-throttle.service';

// Toggles that represent RU pressure on Cosmos DB.
export const COSMOS_PRESSURE_TOGGLES: Array<keyof ChaosState> = [
  'hotPartition',
  'multipleClients',
  'crossPartitionQuery',
  'missingIndexing',
  'pointReadMisuse',
  'metadataThrottling',
];

/**
 * Outcome of mirroring a toggle onto a real Azure resource.
 *
 * The toggle flag alone is not enough to describe the demo's true state: the
 * control-plane call behind vpnConnectivityIssue can fail while the toggle
 * still reads "on", which previously left the UI claiming a broken tunnel
 * while the tunnel was healthy.
 */
export type RealChaosPhase = 'not-applicable' | 'applying' | 'applied' | 'failed';

export interface RealChaosStatus {
  phase: RealChaosPhase;
  /** Populated only when phase is 'failed'. */
  error?: string;
  attempts: number;
  updatedAt: string;
}

const REAL_CHAOS_MAX_ATTEMPTS = 3;
const REAL_CHAOS_RETRY_DELAY_MS = 5_000;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class ChaosService {
  private state: ChaosState = { ...DEFAULT_CHAOS_STATE };

  /**
   * Tracks real Azure operations separately from the toggle flags so a silent
   * control-plane failure is visible rather than being swallowed into a log line.
   */
  private realChaos: Partial<Record<keyof ChaosState, RealChaosStatus>> = {};

  /** Guards against a stale retry overwriting the status of a newer request. */
  private realChaosGeneration: Partial<Record<keyof ChaosState, number>> = {};

  getState(): ChaosState {
    return { ...this.state };
  }

  getRealChaosStatus(): Partial<Record<keyof ChaosState, RealChaosStatus>> {
    return { ...this.realChaos };
  }

  /**
   * True when a toggle claims to be on but the Azure resource behind it was
   * never actually changed. This is the condition that silently breaks a demo.
   */
  getUnappliedToggles(): Array<keyof ChaosState> {
    return (Object.keys(this.realChaos) as Array<keyof ChaosState>).filter(
      (toggle) => this.realChaos[toggle]?.phase === 'failed',
    );
  }

  private setRealChaosStatus(
    toggle: keyof ChaosState,
    phase: RealChaosPhase,
    attempts: number,
    error?: string,
  ): void {
    this.realChaos[toggle] = { phase, attempts, error, updatedAt: new Date().toISOString() };
  }

  enableToggle(toggle: keyof ChaosState): void {
    this.state[toggle] = true;
    this.applyRealAzureChaos(toggle, true);
    this.publishToggleEvent(toggle, true);
  }

  disableToggle(toggle: keyof ChaosState): void {
    this.state[toggle] = false;
    this.applyRealAzureChaos(toggle, false);
    this.publishToggleEvent(toggle, false);
  }

  reset(): void {
    const vpnWasBroken = this.state.vpnConnectivityIssue;
    this.state = { ...DEFAULT_CHAOS_STATE };
    getCpuLoadService().setBurnEnabled(false);
    getCosmosThrottleService().setEnabled(false);
    if (vpnWasBroken) {
      this.applyRealAzureChaos('vpnConnectivityIssue', false);
    }
    // Clear the measurement buffers as well as the toggles. The telemetry
    // snapshot is derived from a five-minute window of recorded operations, so
    // without this the degraded samples from the scenario that just ended keep
    // being reported after the reset: recovery verification fails against a
    // healthy system, and the next scenario is classified from the previous
    // scenario's evidence.
    getTelemetryService().reset();
    getTelemetryService().setChaosState(this.state);
    const event: DemoEvent = {
      id: uuid(),
      partitionKey: 'demo',
      eventType: 'chaos-reset',
      message: 'All chaos toggles reset to healthy baseline.',
      metadata: { state: this.state },
      timestamp: new Date().toISOString(),
    };
    getTelemetryService().recordDemoEvent(event);
  }

  /**
   * Mirrors the toggle onto real Azure resources when the API is running with
   * Azure credentials. Fire-and-forget so the HTTP request is not blocked by a
   * multi-second ARM control-plane call, but the outcome is recorded and
   * retried rather than swallowed: a failed break used to leave the toggle
   * reading "on" against a perfectly healthy tunnel.
   */
  private applyRealAzureChaos(toggle: keyof ChaosState, enabled: boolean): void {
    if (toggle === 'highCpu') {
      // Burn real CPU so Container Insights and the app agree on the symptom.
      getCpuLoadService().setBurnEnabled(enabled);
      return;
    }

    if (COSMOS_PRESSURE_TOGGLES.includes(toggle)) {
      // Drive the provisioned 400 RU/s container hard enough that Cosmos itself
      // returns real 429s. Kept running while any Cosmos pressure toggle is on.
      const stillUnderPressure = COSMOS_PRESSURE_TOGGLES.some((name) => this.state[name]);
      getCosmosThrottleService().setEnabled(enabled || stillUnderPressure);
      return;
    }

    if (toggle !== 'vpnConnectivityIssue') {
      return;
    }

    const vpn = getAzureVpnChaosService();
    if (!vpn.isEnabled()) {
      this.setRealChaosStatus(toggle, 'not-applicable', 0);
      return;
    }

    const generation = (this.realChaosGeneration[toggle] ?? 0) + 1;
    this.realChaosGeneration[toggle] = generation;
    this.setRealChaosStatus(toggle, 'applying', 0);

    void this.runRealVpnChaosWithRetry(toggle, enabled, generation);
  }

  /**
   * ARM calls against a VPN gateway are long-running and intermittently drop the
   * connection ("fetch failed"). A single attempt is not reliable enough to
   * stake a demo on, so retry before declaring failure.
   */
  private async runRealVpnChaosWithRetry(
    toggle: keyof ChaosState,
    enabled: boolean,
    generation: number,
  ): Promise<void> {
    const vpn = getAzureVpnChaosService();
    let lastError = '';

    for (let attempt = 1; attempt <= REAL_CHAOS_MAX_ATTEMPTS; attempt += 1) {
      // A newer enable/disable superseded this one; stop so we do not fight it
      // or report a stale outcome.
      if (this.realChaosGeneration[toggle] !== generation) {
        return;
      }

      try {
        await (enabled ? vpn.breakTunnel() : vpn.healTunnel());

        if (this.realChaosGeneration[toggle] !== generation) {
          return;
        }

        this.setRealChaosStatus(toggle, 'applied', attempt);
        getTelemetryService().recordDemoEvent({
          id: uuid(),
          partitionKey: 'demo',
          eventType: enabled ? 'azure-vpn-broken' : 'azure-vpn-healed',
          message: enabled
            ? 'Rotated the IPsec pre-shared key on the Azure VPN Gateway connection; tunnel is dropping.'
            : 'Restored the IPsec pre-shared key on the Azure VPN Gateway connection; tunnel is renegotiating.',
          metadata: { toggle, enabled, real: true, attempts: attempt },
          timestamp: new Date().toISOString(),
        });
        return;
      } catch (error: unknown) {
        lastError = (error as Error).message;
        console.error(
          `[chaos] real Azure VPN chaos attempt ${attempt}/${REAL_CHAOS_MAX_ATTEMPTS} failed:`,
          lastError,
        );

        if (attempt < REAL_CHAOS_MAX_ATTEMPTS) {
          await delay(REAL_CHAOS_RETRY_DELAY_MS);
        }
      }
    }

    if (this.realChaosGeneration[toggle] !== generation) {
      return;
    }

    this.setRealChaosStatus(toggle, 'failed', REAL_CHAOS_MAX_ATTEMPTS, lastError);
    console.error(
      `[chaos] real Azure VPN chaos FAILED after ${REAL_CHAOS_MAX_ATTEMPTS} attempts. ` +
        `The '${toggle}' toggle reads ${enabled ? 'on' : 'off'} but the tunnel was not changed.`,
    );
    getTelemetryService().recordDemoEvent({
      id: uuid(),
      partitionKey: 'demo',
      eventType: 'azure-vpn-chaos-failed',
      message: `Failed to ${enabled ? 'break' : 'heal'} the Azure VPN tunnel after ${REAL_CHAOS_MAX_ATTEMPTS} attempts. The toggle does not reflect the real tunnel state.`,
      metadata: { toggle, enabled, real: true, error: lastError },
      timestamp: new Date().toISOString(),
    });
  }

  private publishToggleEvent(toggle: keyof ChaosState, enabled: boolean): void {
    getTelemetryService().setChaosState(this.state);
    const event: DemoEvent = {
      id: uuid(),
      partitionKey: 'demo',
      eventType: enabled ? 'chaos-enabled' : 'chaos-disabled',
      message: `${toggle} ${enabled ? 'enabled' : 'disabled'}`,
      metadata: { toggle, enabled, state: this.state },
      timestamp: new Date().toISOString(),
    };

    getTelemetryService().recordDemoEvent(event);
  }
}

let chaosServiceSingleton: ChaosService | undefined;

export const getChaosService = (): ChaosService => {
  if (!chaosServiceSingleton) {
    chaosServiceSingleton = new ChaosService();
    getTelemetryService().setChaosState(chaosServiceSingleton.getState());
  }

  return chaosServiceSingleton;
};
