import { createTestClient } from './test-helpers';

describe('health endpoint', () => {
  it('GET /api/health returns 200 with status field', async () => {
    const response = await createTestClient().get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status');
  });
});
