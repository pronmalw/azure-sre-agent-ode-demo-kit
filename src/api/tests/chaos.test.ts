import { createTestClient } from './test-helpers';
import { getTelemetryService } from '../src/services/telemetry.service';

const toggles = [
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

describe('chaos endpoints', () => {
  it('enables, disables, and resets all chaos toggles', async () => {
    const client = createTestClient();

    for (const toggle of toggles) {
      const onResponse = await client.post(`/api/chaos/${toggle}/on`);
      expect(onResponse.status).toBe(200);
      expect(onResponse.body[toggle]).toBe(true);

      const offResponse = await client.post(`/api/chaos/${toggle}/off`);
      expect(offResponse.status).toBe(200);
      expect(offResponse.body[toggle]).toBe(false);
    }

    await client.post('/api/chaos/hotPartition/on');
    const resetResponse = await client.post('/api/chaos/reset');
    expect(resetResponse.status).toBe(200);
    expect(Object.values(resetResponse.body).every((value) => value === false)).toBe(true);
  });

  it('clears recorded telemetry on reset so recovery verifies against a healthy system', async () => {
    const client = createTestClient();

    // Stand in for a scenario that has just degraded the system. These samples
    // sit inside the snapshot's five-minute window, so before the fix they
    // survived the reset and kept recovery verification failing.
    await client.post('/api/chaos/sqlSlowQuery/on');
    for (let index = 0; index < 5; index += 1) {
      getTelemetryService().recordOperation({
        timestamp: new Date().toISOString(),
        source: 'sql',
        operationType: 'query',
        latencyMs: 5_000,
        statusCode: 200,
      });
      getTelemetryService().recordOperation({
        timestamp: new Date().toISOString(),
        source: 'cosmos',
        operationType: 'query',
        latencyMs: 4_000,
        ruCharge: 250,
        statusCode: 429,
      });
    }

    const degraded = getTelemetryService().getSnapshot();
    expect(degraded.latencyP99Ms).toBeGreaterThan(1_000);
    expect(degraded.cosmos429Count).toBeGreaterThan(0);

    await client.post('/api/chaos/reset');

    const recovered = getTelemetryService().getSnapshot();
    expect(recovered.activeToggles).toEqual([]);
    expect(recovered.latencyP99Ms).toBe(0);
    expect(recovered.cosmos429Count).toBe(0);
    expect(recovered.ruUsage).toBe(0);
    expect(recovered.sqlQueryLatencyMs).toBe(0);

    const verification = await client.post('/api/sre-agent/verify-recovery');
    expect(verification.status).toBe(200);
    expect(verification.body.recovered).toBe(true);

    const opsResponse = await client.get('/api/ops');
    expect(opsResponse.body.activeIncident).toBe(false);
  });
});
