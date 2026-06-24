import { Router } from 'express';
import { Cart } from '../types';
import { getCosmosService } from '../services/cosmos.service';

export const cartRouter = Router();

cartRouter.post('/', async (req, res, next) => {
  try {
    const payload = req.body as Partial<Cart> & { userId?: string };
    const cart: Cart = {
      id: payload.id ?? payload.userId ?? 'demo-customer',
      userId: payload.userId ?? payload.id ?? 'demo-customer',
      items: payload.items ?? [],
      updatedAt: new Date().toISOString(),
    };
    await getCosmosService().upsertCart(cart);
    res.status(201).json(cart);
  } catch (error) {
    next(error);
  }
});

cartRouter.get('/:userId', async (req, res, next) => {
  try {
    const cart = await getCosmosService().getCart(req.params.userId);
    res.json(cart ?? { id: req.params.userId, userId: req.params.userId, items: [], updatedAt: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

cartRouter.delete('/:userId/items/:productId', async (req, res, next) => {
  try {
    await getCosmosService().deleteCartItem(req.params.userId, req.params.productId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
