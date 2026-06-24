import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useChaos } from '../hooks/useChaos';
import { ChaosState, OpsResponse } from '../types';
import api from '../utils/api';

const toggleMetadata: { key: keyof ChaosState; tag: 'COSMOS' | 'SQL' | 'HOST'; description: string }[] = [
  { key: 'hotPartition', tag: 'COSMOS', description: 'Force skewed partition key routing and synthetic 429 pressure.' },
  { key: 'metadataThrottling', tag: 'COSMOS', description: 'Re-fetch container metadata on every request.' },
  { key: 'multipleClients', tag: 'COSMOS', description: 'Create a new CosmosClient per operation.' },
  { key: 'highCpu', tag: 'HOST', description: 'Burn CPU on the request path with synchronous work.' },
  { key: 'crossPartitionQuery', tag: 'COSMOS', description: 'Run fan-out queries without partition filters.' },
  { key: 'largeDocument', tag: 'COSMOS', description: 'Write oversized product documents with padding.' },
  { key: 'missingIndexing', tag: 'COSMOS', description: 'Route reads to the unindexed ProductsNoIndex container.' },
  { key: 'pointReadMisuse', tag: 'COSMOS', description: 'Query by id instead of using a point read.' },
  { key: 'sqlSlowQuery', tag: 'SQL', description: 'Inject slow query behaviour into SQL operations.' },
  { key: 'sqlConnectionPressure', tag: 'SQL', description: 'Hold SQL connections longer than normal release.' },
];

const metricCards = (telemetry: OpsResponse['telemetrySnapshot']) => [
  { label: 'p99 latency', value: `${telemetry.latencyP99Ms} ms`, bad: telemetry.latencyP99Ms > 500 },
  { label: '429 count', value: `${telemetry.cosmos429Count}`, bad: telemetry.cosmos429Count > 0 },
  { label: 'RU / min', value: `${telemetry.ruUsage}`, bad: telemetry.ruUsage > 500 },
  { label: 'Host CPU', value: `${telemetry.hostCpuPercent}%`, bad: telemetry.hostCpuPercent > 70 },
  { label: 'SQL latency', value: `${telemetry.sqlQueryLatencyMs} ms`, bad: telemetry.sqlQueryLatencyMs > 1000 },
  { label: 'Checkout success', value: `${Math.round(telemetry.checkoutSuccessRate * 100)}%`, bad: telemetry.checkoutSuccessRate < 0.95 },
];

export const OpsControlPanel = () => {
  const { state, setToggle, resetAll } = useChaos();
  const [opsData, setOpsData] = useState<OpsResponse>({
    chaosState: state,
    telemetrySnapshot: {
      latencyP50Ms: 0,
      latencyP99Ms: 0,
      cosmos429Count: 0,
      ruUsage: 0,
      serverSideLatencyMs: 12,
      hostCpuPercent: 15,
      checkoutSuccessRate: 1,
      recentDeploymentEvent: false,
      activeToggles: [],
      sqlQueryLatencyMs: 0,
      sqlErrorCount: 0,
      timestamp: new Date().toISOString(),
    },
    activeIncident: false,
    loadGenerator: { running: false, rps: 0 },
    timestamp: new Date().toISOString(),
  });
  const [chartData, setChartData] = useState<{ time: string; latency: number }[]>([]);

  const refresh = async () => {
    try {
      const response = await api.get<OpsResponse>('/ops');
      setOpsData(response.data);
      setChartData((current) => [...current.slice(-59), { time: new Date().toLocaleTimeString(), latency: response.data.telemetrySnapshot.latencyP99Ms }]);
    } catch {
      setOpsData((current) => ({ ...current, chaosState: state }));
    }
  };

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(refresh, 5000);
    return () => window.clearInterval(interval);
  }, [state]);

  const cards = useMemo(() => metricCards(opsData.telemetrySnapshot), [opsData.telemetrySnapshot]);

  const triggerFullIncident = async () => {
    for (const toggle of toggleMetadata) {
      await setToggle(toggle.key, true);
    }
    await refresh();
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Azure SRE Agent — ODE Reduction Demo</h1>
          <p className="mt-2 text-slate-600">Environment: <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold">dev / AKS</span></p>
        </div>
        <Link to="/sre-agent" className="rounded-full bg-contoso-dark px-5 py-3 font-semibold text-white">Open SRE Agent investigation</Link>
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-3xl bg-white p-6 shadow-sm"><h2 className="text-xl font-semibold">Cosmos DB</h2><p className="mt-2 text-slate-600">Catalogue, cart, reviews, telemetry, and investigation documents.</p></div>
        <div className="rounded-3xl bg-white p-6 shadow-sm"><h2 className="text-xl font-semibold">Azure SQL</h2><p className="mt-2 text-slate-600">Orders, pricing, customers, addresses, and inventory summary.</p></div>
      </section>

      <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        {cards.map((card) => (
          <div key={card.label} className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">{card.label}</p>
            <p className={`mt-2 text-2xl font-bold ${card.bad ? 'text-rose-600' : 'text-slate-900'}`}>{card.value}</p>
          </div>
        ))}
      </section>

      <section>
        <div className="mb-4 flex flex-wrap gap-3">
          <button className="rounded-full bg-rose-600 px-5 py-3 font-semibold text-white" onClick={() => void triggerFullIncident()}>Trigger Full Mixed Incident</button>
          <button className="rounded-full border border-slate-200 px-5 py-3 font-semibold text-slate-700" onClick={() => void resetAll()}>Reset to Healthy</button>
          <button className="rounded-full border border-slate-200 px-5 py-3 font-semibold text-slate-700" onClick={() => void api.post('/ops/load/start').then(refresh)}>Start Load</button>
          <button className="rounded-full border border-slate-200 px-5 py-3 font-semibold text-slate-700" onClick={() => void api.post('/ops/load/stop').then(refresh)}>Stop Load</button>
          <span className="rounded-full bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">RPS: {opsData.loadGenerator.rps}</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {toggleMetadata.map((toggle) => (
            <div key={toggle.key} className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">{toggle.key}</p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-contoso-blue">{toggle.tag}</p>
                </div>
                <button
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${state[toggle.key] ? 'bg-rose-600 text-white' : 'bg-emerald-100 text-emerald-700'}`}
                  onClick={() => void setToggle(toggle.key, !state[toggle.key])}
                >
                  {state[toggle.key] ? 'ON' : 'OFF'}
                </button>
              </div>
              <p className="mt-3 text-sm text-slate-600">{toggle.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">Live latency chart</h2>
        <div className="mt-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <XAxis dataKey="time" hide={chartData.length < 2} />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="latency" stroke="#0078D4" strokeWidth={3} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
};
