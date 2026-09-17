import { ChaosState, DEFAULT_CHAOS_STATE, DemoEvent, TelemetrySnapshot } from '../types';
import { getAzureVpnChaosService } from './azure-vpn-chaos.service';
import { getCpuLoadService } from './cpu-load.service';

export interface TelemetryOperationRecord {
  timestamp: string;
  source: 'cosmos' | 'sql' | 'app';
  operationType: string;
  latencyMs: number;
  ruCharge?: number;
  statusCode: number;
  partitionKey?: string;
  /**
   * Time spent inside the Azure service call itself, excluding any latency the
   * application added on top. This is what separates "Azure is slow" from
   * "our code is slow" in the incident classification.
   */
  serviceLatencyMs?: number;
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
      // Real CPU pressure is produced continuously by the CPU load service
      // (see cpu-load.service.ts), so nothing synthetic is needed here.
      getCpuLoadService().ensureBurnEnabled();
    }

    // Real measured process CPU (percent of one core, matching the container's
    // 1000m limit). Falls back to the simulated model only when no real sample
    // is available yet, so the demo never reports a number Azure would contradict.
    const cpuService = getCpuLoadService();
    const measuredCpu = cpuService.getCpuPercent();
    const simulatedHostCpu = 15
      + (this.chaosState.multipleClients ? 15 : 0)
      + (this.chaosState.highCpu ? 65 : 0)
      + (this.chaosState.sqlConnectionPressure ? 10 : 0);
    const hostCpuPercent = measuredCpu > 0 ? measuredCpu : simulatedHostCpu;

    const highCosmosSignals = cosmosOps.filter((record) => record.statusCode === 429).length > 10;
    const likelyAzureServiceIssue = Object.values(this.chaosState).every((enabled) => !enabled) && highCosmosSignals && percentile(latencies, 99) > 1000;

    const networkPacketLossPercent = this.chaosState.vpnConnectivityIssue ? 42 : 0;
    const vpnTunnelStatus: 'connected' | 'degraded' | 'down' = this.chaosState.vpnConnectivityIssue ? 'down' : 'connected';

    // Prefer the real Azure VPN Gateway connection state when the API runs in Azure.
    // getReading() is cached and refreshed in the background, so this never blocks.
    const vpnService = getAzureVpnChaosService();
    let effectivePacketLoss = networkPacketLossPercent;
    let effectiveTunnelStatus: 'connected' | 'degraded' | 'down' = vpnTunnelStatus;

    if (vpnService.isEnabled()) {
      void vpnService.getReading();
      const live = vpnService.getCachedReading();
      // Only trust the live reading when Azure actually reported a state. While the
      // gateway is still provisioning (or unreachable) we keep the simulated values
      // so the demo never silently loses its VPN signal.
      if (live && live.connectionStatus !== 'Unknown') {
        effectiveTunnelStatus = live.status;
        effectivePacketLoss = live.packetLossPercent;
      }
    }

    // Real Azure-side latency: the measured duration of the Cosmos SDK call
    // itself, excluding the latency this application adds. Only successful
    // calls count, and the median is used rather than a tail percentile —
    // the question this answers is "when Azure responds, is it fast?", which
    // is what rules an Azure-side outage in or out. Throttled calls are
    // deliberately excluded: their latency reflects RU exhaustion caused by
    // the client's access pattern, not Cosmos being unhealthy.
    const serviceLatencySamples = cosmosOps
      .filter((record) => record.statusCode < 400)
      .map((record) => record.serviceLatencyMs)
      .filter((value): value is number => typeof value === 'number');
    const measuredServerSideLatency = percentile(serviceLatencySamples, 50);
    const serverSideLatencyMs =
      serviceLatencySamples.length > 0 ? measuredServerSideLatency : likelyAzureServiceIssue ? 650 : 12;

    return {
      latencyP50Ms: percentile(latencies, 50),
      latencyP99Ms: percentile(latencies, 99),
      cosmos429Count: cosmosOps.filter((record) => record.statusCode === 429).length,
      ruUsage: Math.round(cosmosOps.reduce((sum, record) => sum + (record.ruCharge ?? 0), 0) * 100) / 100,
      serverSideLatencyMs,
      hostCpuPercent,
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
      networkPacketLossPercent: effectivePacketLoss,
      vpnTunnelStatus: effectiveTunnelStatus,
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
