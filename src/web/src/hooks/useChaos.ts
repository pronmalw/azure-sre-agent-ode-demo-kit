import { useCallback, useEffect, useState } from 'react';
import api from '../utils/api';
import { ChaosState, OpsResponse } from '../types';

const emptyState: ChaosState = {
  hotPartition: false,
  metadataThrottling: false,
  multipleClients: false,
  highCpu: false,
  crossPartitionQuery: false,
  largeDocument: false,
  missingIndexing: false,
  pointReadMisuse: false,
  sqlSlowQuery: false,
  sqlConnectionPressure: false,
};

export const useChaos = () => {
  const [state, setState] = useState<ChaosState>(emptyState);

  const refresh = useCallback(async () => {
    try {
      const response = await api.get<OpsResponse>('/ops');
      setState(response.data.chaosState);
    } catch {
      setState((current) => current);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setToggle = useCallback(async (toggle: keyof ChaosState, enabled: boolean) => {
    await api.post(`/chaos/${toggle}/${enabled ? 'on' : 'off'}`);
    await refresh();
  }, [refresh]);

  const resetAll = useCallback(async () => {
    await api.post('/chaos/reset');
    await refresh();
  }, [refresh]);

  return { state, refresh, setToggle, resetAll };
};
