import dotenv from 'dotenv';
import path from 'path';
import { AppConfig } from './types';

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
};

export const isCosmosConfigured = (): boolean => Boolean(appConfig.cosmosEndpoint && appConfig.cosmosKey);
export const isSqlConfigured = (): boolean => Boolean(appConfig.sqlServer && appConfig.sqlDatabase && appConfig.sqlUser && appConfig.sqlPassword);
