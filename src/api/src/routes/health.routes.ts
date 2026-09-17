import { Router } from 'express';
import { isCosmosConfigured, isSqlConfigured } from '../config';
import { getChaosService } from '../services/chaos.service';
import { getCosmosService } from '../services/cosmos.service';
import { getSqlService } from '../services/sql.service';
import { getTelemetryService } from '../services/telemetry.service';

export const healthRouter = Router();

/**
 * Liveness/readiness endpoint. Deliberately checks nothing except that the
 * process is running and the event loop is turning.
 *
 * The richer '/' handler below performs live Cosmos and SQL round trips, which
 * makes it unsuitable for probes: this demo intentionally degrades those
 * dependencies, and a slow dependency must not cause Kubernetes to evict a pod
 * that is still serving traffic perfectly well. Pointing probes at a dependency
 * check turns a degraded backend into a full outage.
 */
healthRouter.get('/live', (_req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

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
