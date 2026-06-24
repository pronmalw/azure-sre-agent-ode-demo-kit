import { createTestClient } from './test-helpers';

describe('products endpoints', () => {
  it('GET /api/products returns array and GET /api/products/:id returns product', async () => {
    const client = createTestClient();
    const listResponse = await client.get('/api/products');
    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
    expect(listResponse.body.length).toBeGreaterThan(0);

    const detailResponse = await client.get('/api/products/laptop-001');
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.id).toBe('laptop-001');
    expect(detailResponse.body.pricing).toBeTruthy();
  });
});
