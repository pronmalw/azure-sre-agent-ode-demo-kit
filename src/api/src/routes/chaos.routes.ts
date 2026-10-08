import { Router } from 'express';
import { ChaosState } from '../types';
import { getChaosService } from '../services/chaos.service';

export const chaosRouter = Router();

const toggles: (keyof ChaosState)[] = [
  'hotPartition',
  'metadataThrottling',
  'multipleClients',
  'highCpu',
  'crossPartitionQuery',
  'largeDocument',
  'missingIndexing',
  'pointReadMisuse',
  'sqlSlowQuery',
  'sqlConnectionPressure',
  'vpnConnectivityIssue',
];

chaosRouter.get('/', (_req, res) => {
  res.json(getChaosService().getState());
});

/**
 * Reports whether the toggles actually took effect on the real Azure resources
 * behind them. GET / returns the requested state; this returns the applied
 * state, which can differ when an ARM control-plane call fails.
 */
chaosRouter.get('/status', (_req, res) => {
  const chaos = getChaosService();
  const unapplied = chaos.getUnappliedToggles();
  res.json({
    toggles: chaos.getState(),
    realChaos: chaos.getRealChaosStatus(),
    unappliedToggles: unapplied,
    inSync: unapplied.length === 0,
  });
});

for (const toggle of toggles) {
  chaosRouter.post(`/${toggle}/on`, (_req, res) => {
    getChaosService().enableToggle(toggle);
    res.json(getChaosService().getState());
  });

  chaosRouter.post(`/${toggle}/off`, (_req, res) => {
    getChaosService().disableToggle(toggle);
    res.json(getChaosService().getState());
  });
}

chaosRouter.post('/reset', (_req, res) => {
  getChaosService().reset();
  res.json(getChaosService().getState());
});
