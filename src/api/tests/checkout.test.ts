import { createTestClient } from './test-helpers';

describe('checkout endpoints', () => {
  it('POST /api/checkout creates order and GET /api/orders/:customerId lists orders', async () => {
    const client = createTestClient();
    const userId = 'checkout-user';
    await client.post('/api/cart').send({
      userId,
      items: [{ productId: 'tablet-001', productName: 'Tablet Air', quantity: 1, unitPrice: 549 }],
    });

    const checkoutResponse = await client.post('/api/checkout').send({ customerId: userId, userId, name: 'Checkout User', email: 'checkout@contoso.demo' });
    expect(checkoutResponse.status).toBe(201);
    expect(checkoutResponse.body.orderId).toBeTruthy();

    const ordersResponse = await client.get(`/api/orders/${userId}`);
    expect(ordersResponse.status).toBe(200);
    expect(ordersResponse.body.length).toBeGreaterThan(0);
  });
});
