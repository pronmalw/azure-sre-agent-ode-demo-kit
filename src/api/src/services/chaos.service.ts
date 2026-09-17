import { v4 as uuid } from 'uuid';
import { ChaosState, DEFAULT_CHAOS_STATE, DemoEvent } from '../types';
import { getTelemetryService } from './telemetry.service';
import { getAzureVpnChaosService } from './azure-vpn-chaos.service';
import { getCpuLoadService } from './cpu-load.service';
import { getCosmosThrottleService } from './cosmos-throttle.service';

// Toggles that represent RU pressure on Cosmos DB.
const COSMOS_PRESSURE_TOGGLES: Array<keyof ChaosState> = [
  'hotPartition',
  'multipleClients',
  'crossPartitionQuery',
  'missingIndexing',
  'pointReadMisuse',
  'metadataThrottling',
];

export class ChaosService {
  private state: ChaosState = { ...DEFAULT_CHAOS_STATE };

  getState(): ChaosState {
    return { ...this.state };
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
   * multi-second ARM control-plane call.
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
      return;
    }

    const action = enabled ? vpn.breakTunnel() : vpn.healTunnel();
    action
      .then(() => {
        getTelemetryService().recordDemoEvent({
          id: uuid(),
          partitionKey: 'demo',
          eventType: enabled ? 'azure-vpn-broken' : 'azure-vpn-healed',
          message: enabled
            ? 'Rotated the IPsec pre-shared key on the Azure VPN Gateway connection; tunnel is dropping.'
            : 'Restored the IPsec pre-shared key on the Azure VPN Gateway connection; tunnel is renegotiating.',
          metadata: { toggle, enabled, real: true },
          timestamp: new Date().toISOString(),
        });
      })
      .catch((error: unknown) => {
        console.error('[chaos] real Azure VPN chaos failed:', (error as Error).message);
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
