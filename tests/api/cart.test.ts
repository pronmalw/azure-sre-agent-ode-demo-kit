import { createTestClient } from './test-helpers';

describe('cart endpoints', () => {
  it('POST /api/cart creates cart and GET /api/cart/:userId retrieves it', async () => {
    const client = createTestClient();
    const payload = {
      userId: 'cart-test-user',
      items: [{ productId: 'phone-001', productName: 'Smartphone X15', quantity: 2, unitPrice: 799 }],
    };

    const createResponse = await client.post('/api/cart').send(payload);
    expect(createResponse.status).toBe(201);

    const getResponse = await client.get('/api/cart/cart-test-user');
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.items).toHaveLength(1);
  });
});
