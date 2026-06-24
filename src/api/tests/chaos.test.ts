import { createTestClient } from './test-helpers';

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
});
