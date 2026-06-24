import { Link } from 'react-router-dom';
import { useHealth } from '../hooks/useHealth';

export const ServiceHealthBanner = () => {
  const health = useHealth();
  const severity = health.status === 'healthy' ? 'green' : health.latencyP99Ms > 1500 || health.cosmos429Count > 10 ? 'red' : 'amber';

  if (severity === 'green') {
    return <div className="bg-emerald-100 px-4 py-2 text-sm text-emerald-900">✓ All systems operational — Cosmos: healthy | SQL: healthy | p99: {health.latencyP99Ms}ms</div>;
  }

  if (severity === 'red') {
    return (
      <div className="bg-rose-100 px-4 py-2 text-sm text-rose-900">
        ✗ Service disruption in progress — p99: {health.latencyP99Ms}ms | Investigation: <Link className="font-semibold underline" to="/sre-agent">/sre-agent</Link>
      </div>
    );
  }

  return <div className="bg-amber-100 px-4 py-2 text-sm text-amber-900">⚠ Degraded performance detected — p99: {health.latencyP99Ms}ms | 429s: {health.cosmos429Count}</div>;
};
