import { v4 as uuid } from 'uuid';
import { ChaosState, DEFAULT_CHAOS_STATE, DemoEvent } from '../types';
import { getTelemetryService } from './telemetry.service';

export class ChaosService {
  private state: ChaosState = { ...DEFAULT_CHAOS_STATE };

  getState(): ChaosState {
    return { ...this.state };
  }

  enableToggle(toggle: keyof ChaosState): void {
    this.state[toggle] = true;
    this.publishToggleEvent(toggle, true);
  }

  disableToggle(toggle: keyof ChaosState): void {
    this.state[toggle] = false;
    this.publishToggleEvent(toggle, false);
  }

  reset(): void {
    this.state = { ...DEFAULT_CHAOS_STATE };
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
