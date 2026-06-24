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
];

chaosRouter.get('/', (_req, res) => {
  res.json(getChaosService().getState());
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
