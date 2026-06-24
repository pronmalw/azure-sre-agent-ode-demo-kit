import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getCosmosService } from '../services/cosmos.service';
import { getSqlService } from '../services/sql.service';
import { Cart, Customer, Order, OrderItem } from '../types';

export const ordersRouter = Router();

ordersRouter.post('/checkout', async (req, res, next) => {
  try {
    const userId = req.body.userId ?? req.body.customerId ?? 'demo-customer';
    const cosmosService = getCosmosService();
    const sqlService = getSqlService();
    let cart = (await cosmosService.getCart(userId)) as Cart | null;

    if ((!cart || cart.items.length === 0) && Array.isArray(req.body.cart?.items)) {
      cart = {
        id: userId,
        userId,
        items: req.body.cart.items,
        updatedAt: new Date().toISOString(),
      };
      await cosmosService.upsertCart(cart);
    }

    if (!cart || cart.items.length === 0) {
      res.status(400).json({ message: 'Cart is empty' });
      return;
    }

    const customer: Customer = {
      customerId: req.body.customerId ?? userId,
      name: req.body.name ?? req.body.customer?.name ?? 'Demo Customer',
      email: req.body.email ?? req.body.customer?.email ?? 'demo@contoso.demo',
      createdAt: new Date().toISOString(),
    };
    await sqlService.upsertCustomer(customer);

    const orderId = uuid();
    const items: OrderItem[] = cart.items.map((item) => ({
      orderItemId: uuid(),
      orderId,
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.unitPrice * item.quantity,
    }));
    const order: Order = {
      orderId,
      customerId: customer.customerId,
      orderDate: new Date().toISOString(),
      status: 'confirmed',
      totalAmount: items.reduce((sum, item) => sum + item.lineTotal, 0),
      paymentStatus: 'completed',
      items,
    };

    await sqlService.createOrder(order);
    await cosmosService.upsertCart({ id: userId, userId, items: [], updatedAt: new Date().toISOString() });
    res.status(201).json({ orderId, order });
  } catch (error) {
    next(error);
  }
});

ordersRouter.get('/orders/:customerId', async (req, res, next) => {
  try {
    const orders = await getSqlService().getOrders(req.params.customerId);
    res.json(orders);
  } catch (error) {
    next(error);
  }
});

ordersRouter.get('/orders/detail/:orderId', async (req, res, next) => {
  try {
    const order = await getSqlService().getOrder(req.params.orderId);
    if (!order) {
      res.status(404).json({ message: 'Order not found' });
      return;
    }
    res.json(order);
  } catch (error) {
    next(error);
  }
});
