import { ChaosState, DEFAULT_CHAOS_STATE, DemoEvent, TelemetrySnapshot } from '../types';

export interface TelemetryOperationRecord {
  timestamp: string;
  source: 'cosmos' | 'sql' | 'app';
  operationType: string;
  latencyMs: number;
  ruCharge?: number;
  statusCode: number;
  partitionKey?: string;
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const RING_BUFFER_SIZE = 200;

const percentile = (values: number[], percentileValue: number): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1));
  return Math.round(sorted[index] * 100) / 100;
};

const average = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
};

const fibonacci = (value: number): number => (value <= 1 ? value : fibonacci(value - 1) + fibonacci(value - 2));

export class TelemetryService {
  private readonly operations: TelemetryOperationRecord[] = [];
  private readonly demoEvents: DemoEvent[] = [];
  private chaosState: ChaosState = { ...DEFAULT_CHAOS_STATE };

  recordOperation(record: TelemetryOperationRecord): void {
    this.operations.push(record);
    if (this.operations.length > RING_BUFFER_SIZE) {
      this.operations.splice(0, this.operations.length - RING_BUFFER_SIZE);
    }
  }

  recordDemoEvent(event: DemoEvent): void {
    this.demoEvents.push(event);
    if (this.demoEvents.length > RING_BUFFER_SIZE) {
      this.demoEvents.splice(0, this.demoEvents.length - RING_BUFFER_SIZE);
    }
  }

  setChaosState(state: ChaosState): void {
    this.chaosState = { ...state };
  }

  getSnapshot(): TelemetrySnapshot {
    const now = Date.now();
    const recentOperations = this.operations.filter((record) => now - new Date(record.timestamp).getTime() <= FIVE_MINUTES_MS);
    const recentDemoEvents = this.demoEvents.filter((event) => now - new Date(event.timestamp).getTime() <= TEN_MINUTES_MS);

    const latencies = recentOperations.map((record) => record.latencyMs);
    const cosmosOps = recentOperations.filter((record) => record.source === 'cosmos');
    const sqlOps = recentOperations.filter((record) => record.source === 'sql');
    const checkoutOps = recentOperations.filter((record) => record.operationType === 'checkout');

    if (this.chaosState.highCpu) {
      fibonacci(35);
    }

    const simulatedHostCpu = 15
      + (this.chaosState.multipleClients ? 15 : 0)
      + (this.chaosState.highCpu ? 45 : 0)
      + (this.chaosState.sqlConnectionPressure ? 10 : 0);

    const highCosmosSignals = cosmosOps.filter((record) => record.statusCode === 429).length > 10;
    const likelyAzureServiceIssue = Object.values(this.chaosState).every((enabled) => !enabled) && highCosmosSignals && percentile(latencies, 99) > 1000;

    return {
      latencyP50Ms: percentile(latencies, 50),
      latencyP99Ms: percentile(latencies, 99),
      cosmos429Count: cosmosOps.filter((record) => record.statusCode === 429).length,
      ruUsage: Math.round(cosmosOps.reduce((sum, record) => sum + (record.ruCharge ?? 0), 0) * 100) / 100,
      serverSideLatencyMs: likelyAzureServiceIssue ? 650 : 12,
      hostCpuPercent: simulatedHostCpu,
      checkoutSuccessRate:
        checkoutOps.length === 0
          ? 1
          : Math.round(
              (checkoutOps.filter((record) => record.statusCode >= 200 && record.statusCode < 400).length / checkoutOps.length) * 100,
            ) / 100,
      recentDeploymentEvent: recentDemoEvents.some((event) => event.eventType === 'deployment'),
      activeToggles: Object.entries(this.chaosState)
        .filter(([, enabled]) => enabled)
        .map(([toggle]) => toggle),
      sqlQueryLatencyMs: average(sqlOps.map((record) => record.latencyMs)),
      sqlErrorCount: sqlOps.filter((record) => record.statusCode >= 400).length,
      timestamp: new Date().toISOString(),
    };
  }

  reset(): void {
    this.operations.splice(0, this.operations.length);
    this.demoEvents.splice(0, this.demoEvents.length);
    this.chaosState = { ...DEFAULT_CHAOS_STATE };
  }
}

let telemetryServiceSingleton: TelemetryService | undefined;

export const getTelemetryService = (): TelemetryService => {
  if (!telemetryServiceSingleton) {
    telemetryServiceSingleton = new TelemetryService();
  }

  return telemetryServiceSingleton;
};
