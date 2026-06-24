import { Router } from 'express';
import { isCosmosConfigured, isSqlConfigured } from '../config';
import { getChaosService } from '../services/chaos.service';
import { getCosmosService } from '../services/cosmos.service';
import { getSqlService } from '../services/sql.service';
import { getTelemetryService } from '../services/telemetry.service';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  const telemetrySnapshot = getTelemetryService().getSnapshot();
  const cosmos = !isCosmosConfigured() ? 'not-configured' : (await getCosmosService().healthCheck()) ? 'ok' : 'error';
  const sql = !isSqlConfigured() ? 'not-configured' : (await getSqlService().healthCheck()) ? 'ok' : 'error';
  const status =
    cosmos === 'error' || sql === 'error' || telemetrySnapshot.latencyP99Ms > 500 || telemetrySnapshot.cosmos429Count > 0
      ? 'degraded'
      : 'healthy';

  res.json({
    status,
    cosmos,
    sql,
    latencyP99Ms: telemetrySnapshot.latencyP99Ms,
    cosmos429Count: telemetrySnapshot.cosmos429Count,
    activeToggles: getChaosService().getState(),
    timestamp: new Date().toISOString(),
  });
});
