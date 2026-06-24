import { useEffect, useState } from 'react';
import api from '../utils/api';
import { HealthResponse } from '../types';

const fallbackHealth: HealthResponse = {
  status: 'healthy',
  cosmos: 'not-configured',
  sql: 'not-configured',
  latencyP99Ms: 0,
  cosmos429Count: 0,
  activeToggles: {
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
  },
  timestamp: new Date().toISOString(),
};

export const useHealth = () => {
  const [health, setHealth] = useState<HealthResponse>(fallbackHealth);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await api.get<HealthResponse>('/health');
        if (!cancelled) {
          setHealth(response.data);
        }
      } catch {
        if (!cancelled) {
          setHealth((current) => current ?? fallbackHealth);
        }
      }
    };

    void load();
    const interval = window.setInterval(load, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return health;
};
