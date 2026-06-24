import { createTestClient } from './test-helpers';

describe('ops endpoints', () => {
  it('GET /api/ops returns telemetry and load start/stop work', async () => {
    const client = createTestClient();
    const opsResponse = await client.get('/api/ops');
    expect(opsResponse.status).toBe(200);
    expect(opsResponse.body).toHaveProperty('telemetrySnapshot');

    const startResponse = await client.post('/api/ops/load/start');
    expect(startResponse.status).toBe(202);
    expect(startResponse.body.running).toBe(true);

    const stopResponse = await client.post('/api/ops/load/stop');
    expect(stopResponse.status).toBe(200);
    expect(stopResponse.body.running).toBe(false);
  });
});
