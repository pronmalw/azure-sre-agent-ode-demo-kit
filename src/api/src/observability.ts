import * as appInsights from 'applicationinsights';
import { appConfig, isAppInsightsConfigured } from './config';

const CLOUD_ROLE = process.env.APPINSIGHTS_CLOUD_ROLE ?? 'contoso-retail-api';
const METRIC_PUSH_INTERVAL_MS = 30_000;

let started = false;
let metricTimer: NodeJS.Timeout | null = null;

/**
 * Boots the Application Insights SDK. Must be called before Express and the
 * Azure SDK clients are constructed so that auto-instrumentation can patch
 * http, mssql and the Cosmos SDK.
 */
export const startObservability = (): void => {
  if (started || !isAppInsightsConfigured()) {
    if (!isAppInsightsConfigured()) {
      console.warn('[observability] APPINSIGHTS_CONNECTION_STRING is not set - telemetry will NOT reach Azure Monitor.');
    }
    return;
  }

  appInsights
    .setup(appConfig.appInsightsConnectionString)
    .setAutoDependencyCorrelation(true)
    .setAutoCollectRequests(true)
    .setAutoCollectPerformance(true, true)
    .setAutoCollectExceptions(true)
    .setAutoCollectDependencies(true)
    .setAutoCollectConsole(true, true)
    .setUseDiskRetryCaching(true)
    .setSendLiveMetrics(true)
    .setDistributedTracingMode(appInsights.DistributedTracingModes.AI_AND_W3C);

  const client = appInsights.defaultClient;
  client.context.tags[client.context.keys.cloudRole] = CLOUD_ROLE;
  client.context.tags[client.context.keys.cloudRoleInstance] = process.env.HOSTNAME ?? 'local';

  appInsights.start();
  started = true;
  console.log(`[observability] Application Insights started (cloudRole=${CLOUD_ROLE}).`);
};

/**
 * Publishes the demo's golden signals to Azure Monitor as custom metrics so that
 * metric alert rules - and therefore the Azure SRE Agent's incident feed - can
 * fire on them. Without this the chaos toggles would only be visible inside the
 * app's own memory.
 */
export const startMetricPublisher = (getSnapshot: () => Record<string, unknown>): void => {
  if (!isAppInsightsConfigured() || metricTimer) {
    return;
  }

  const client = appInsights.defaultClient;

  metricTimer = setInterval(() => {
    try {
      const snapshot = getSnapshot();
      const activeToggles = Array.isArray(snapshot.activeToggles) ? (snapshot.activeToggles as string[]) : [];
      const properties = {
        activeToggles: activeToggles.join(',') || 'none',
        vpnTunnelStatus: String(snapshot.vpnTunnelStatus ?? 'unknown'),
      };

      const numericMetrics: Array<[string, unknown]> = [
        ['contoso.latencyP99Ms', snapshot.latencyP99Ms],
        ['contoso.latencyP50Ms', snapshot.latencyP50Ms],
        ['contoso.cosmos429Count', snapshot.cosmos429Count],
        ['contoso.ruUsage', snapshot.ruUsage],
        ['contoso.hostCpuPercent', snapshot.hostCpuPercent],
        ['contoso.sqlQueryLatencyMs', snapshot.sqlQueryLatencyMs],
        ['contoso.sqlErrorCount', snapshot.sqlErrorCount],
        ['contoso.checkoutSuccessRate', snapshot.checkoutSuccessRate],
        ['contoso.networkPacketLossPercent', snapshot.networkPacketLossPercent],
        ['contoso.activeToggleCount', activeToggles.length],
        // Numeric mirror of the tunnel state so a metric alert can trigger on it.
        ['contoso.vpnTunnelDown', snapshot.vpnTunnelStatus === 'down' ? 1 : 0],
      ];

      for (const [name, value] of numericMetrics) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          client.trackMetric({ name, value, properties });
        }
      }

      client.trackEvent({ name: 'ContosoTelemetrySnapshot', properties, measurements: { activeToggles: activeToggles.length } });
    } catch (error) {
      console.error('[observability] failed to publish custom metrics:', (error as Error).message);
    }
  }, METRIC_PUSH_INTERVAL_MS);

  metricTimer.unref?.();
  console.log('[observability] custom metric publisher started.');
};

export const trackChaosEvent = (name: string, properties: Record<string, string>): void => {
  if (!isAppInsightsConfigured()) {
    return;
  }

  appInsights.defaultClient.trackEvent({ name, properties });
};
