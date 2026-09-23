import dotenv from 'dotenv';
import path from 'path';
import { AppConfig } from './types';

// The README documents src/api/.env, but the previous single lookup only
// resolved src/api/src/.env. Load both (dotenv never overrides variables that
// are already set, so real env vars injected by Kubernetes still win).
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'src', '.env') });

export const appConfig: AppConfig = {
  cosmosEndpoint: process.env.COSMOS_ENDPOINT ?? '',
  cosmosKey: process.env.COSMOS_KEY ?? '',
  cosmosDatabaseId: process.env.COSMOS_DATABASE_ID ?? 'contoso-retail',
  sqlServer: process.env.SQL_SERVER ?? '',
  sqlDatabase: process.env.SQL_DATABASE ?? 'contoso-retail-db',
  sqlUser: process.env.SQL_USER ?? '',
  sqlPassword: process.env.SQL_PASSWORD ?? '',
  appInsightsConnectionString: process.env.APPINSIGHTS_CONNECTION_STRING ?? '',
  port: Number.parseInt(process.env.PORT ?? '3001', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  // Dedicated provisioned-throughput container used to generate real Cosmos 429s.
  // The main account is serverless and cannot be capped at a low RU ceiling.
  throttleCosmosEndpoint: process.env.THROTTLE_COSMOS_ENDPOINT ?? '',
  throttleCosmosKey: process.env.THROTTLE_COSMOS_KEY ?? '',
  throttleCosmosDatabaseId: process.env.THROTTLE_COSMOS_DATABASE_ID ?? 'throttle-demo',
  throttleCosmosContainerId: process.env.THROTTLE_COSMOS_CONTAINER_ID ?? 'HotPartition',
};

export const azureConfig = {
  subscriptionId: process.env.AZURE_SUBSCRIPTION_ID ?? '',
  resourceGroup: process.env.AZURE_RESOURCE_GROUP ?? '',
  vpnConnectionName: process.env.VPN_CONNECTION_NAME ?? '',
  vpnGatewayName: process.env.VPN_GATEWAY_NAME ?? '',
  vpnHealthySharedKey: process.env.VPN_HEALTHY_SHARED_KEY ?? '',
};

export const isCosmosConfigured = (): boolean => Boolean(appConfig.cosmosEndpoint && appConfig.cosmosKey);
export const isSqlConfigured = (): boolean => Boolean(appConfig.sqlServer && appConfig.sqlDatabase && appConfig.sqlUser && appConfig.sqlPassword);
export const isAppInsightsConfigured = (): boolean => Boolean(appConfig.appInsightsConnectionString);
export const isThrottleProbeConfigured = (): boolean =>
  Boolean(appConfig.throttleCosmosEndpoint && appConfig.throttleCosmosKey);

// When true the VPN chaos toggle mutates a real Azure VPN Gateway connection
// instead of only simulating packet loss in the telemetry snapshot.
export const isAzureVpnConfigured = (): boolean =>
  Boolean(
    azureConfig.subscriptionId &&
      azureConfig.resourceGroup &&
      azureConfig.vpnConnectionName &&
      azureConfig.vpnHealthySharedKey,
  );
