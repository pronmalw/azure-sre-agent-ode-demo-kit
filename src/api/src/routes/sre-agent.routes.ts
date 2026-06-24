import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getChaosService } from '../services/chaos.service';
import { getCosmosService } from '../services/cosmos.service';
import { classifyIncident } from '../services/sre-classifier.service';
import { getTelemetryService } from '../services/telemetry.service';
import { SreAgentReport, TelemetrySnapshot } from '../types';

export const sreAgentRouter = Router();

let cachedReport: SreAgentReport | null = null;

const buildReport = async (override?: Partial<TelemetrySnapshot>, incidentId?: string): Promise<SreAgentReport> => {
  const snapshot = { ...getTelemetryService().getSnapshot(), ...override } as TelemetrySnapshot;
  const report = classifyIncident(snapshot);
  report.incidentId = incidentId ?? report.incidentId;
  await getCosmosService().saveInvestigation(report);
  await getCosmosService().logDemoEvent({
    id: uuid(),
    partitionKey: 'demo',
    eventType: 'investigation',
    message: `SRE Agent investigation generated for ${report.incidentId}`,
    metadata: { primaryClassification: report.primaryClassification, confidence: report.confidence },
    timestamp: new Date().toISOString(),
  });
  cachedReport = report;
  return report;
};

sreAgentRouter.get('/', (_req, res) => {
  res.redirect('/sre-agent/investigate');
});

sreAgentRouter.get('/investigate', async (_req, res, next) => {
  try {
    const report = await buildReport(undefined, `inc-${Date.now()}`);
    res.json(report);
  } catch (error) {
    next(error);
  }
});

sreAgentRouter.post('/investigate', async (req, res, next) => {
  try {
    const report = await buildReport(req.body?.snapshot ?? req.body, req.body?.incidentId ?? `inc-${Date.now()}`);
    res.json(report);
  } catch (error) {
    next(error);
  }
});

sreAgentRouter.get('/report', async (_req, res, next) => {
  try {
    const report = cachedReport ?? (await buildReport(undefined, `inc-${Date.now()}`));
    res.json(report);
  } catch (error) {
    next(error);
  }
});

sreAgentRouter.post('/verify-recovery', async (_req, res, next) => {
  try {
    const snapshot = getTelemetryService().getSnapshot();
    const checks = [
      { criterion: 'p99 end-to-end latency returns to <200ms baseline', pass: snapshot.latencyP99Ms < 200 },
      { criterion: 'Zero Cosmos DB 429 errors in 5-minute validation window', pass: snapshot.cosmos429Count === 0 },
      { criterion: 'Host CPU returns to <30% baseline', pass: snapshot.hostCpuPercent < 30 },
      { criterion: 'CosmosClient singleton verified — one instance at application startup', pass: !getChaosService().getState().multipleClients },
      { criterion: 'Query RU per operation <50 RU/s', pass: snapshot.ruUsage < 50 },
      { criterion: 'Unindexed query RU improves after indexing policy restored', pass: !getChaosService().getState().missingIndexing },
      { criterion: 'Checkout order write succeeds in Azure SQL in <200ms', pass: snapshot.sqlQueryLatencyMs < 200 },
      { criterion: 'SQL query latency returns to <100ms', pass: snapshot.sqlQueryLatencyMs < 100 },
      { criterion: 'SQL connection pool utilization <60%', pass: !getChaosService().getState().sqlConnectionPressure },
    ];
    res.json({ recovered: checks.every((check) => check.pass), checks, snapshot, cachedReport });
  } catch (error) {
    next(error);
  }
});
