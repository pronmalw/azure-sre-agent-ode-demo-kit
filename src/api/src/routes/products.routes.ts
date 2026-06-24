import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getCosmosService } from '../services/cosmos.service';
import { getSqlService } from '../services/sql.service';
import { Review } from '../types';

export const productsRouter = Router();

productsRouter.get('/', async (req, res, next) => {
  try {
    const categoryId = typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined;
    const cosmosService = getCosmosService();
    const sqlService = getSqlService();
    const products = await cosmosService.getProducts(categoryId);
    const pricing = await sqlService.getMultiplePricing(products.map((product) => product.id));
    const pricingMap = new Map(pricing.map((price) => [price.productId, price]));
    res.json(products.map((product) => ({ ...product, pricing: pricingMap.get(product.id) ?? null })));
  } catch (error) {
    next(error);
  }
});

productsRouter.get('/search', async (req, res, next) => {
  try {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const query = typeof req.query.q === 'string' ? req.query.q.toLowerCase() : '';
    const products = await getCosmosService().getProducts(category);
    const filtered = products.filter((product) => {
      const haystack = `${product.name} ${product.description} ${product.categoryName}`.toLowerCase();
      return haystack.includes(query);
    });
    const pricing = await getSqlService().getMultiplePricing(filtered.map((product) => product.id));
    const pricingMap = new Map(pricing.map((price) => [price.productId, price]));
    res.json(filtered.map((product) => ({ ...product, pricing: pricingMap.get(product.id) ?? null })));
  } catch (error) {
    next(error);
  }
});

productsRouter.get('/:id', async (req, res, next) => {
  try {
    const product = await getCosmosService().getProduct(req.params.id);
    if (!product) {
      res.status(404).json({ message: 'Product not found' });
      return;
    }

    const pricing = await getSqlService().getProductPricing(product.id);
    res.json({ ...product, pricing });
  } catch (error) {
    next(error);
  }
});

productsRouter.get('/:id/reviews', async (req, res, next) => {
  try {
    const reviews = await getCosmosService().getReviews(req.params.id);
    res.json(reviews);
  } catch (error) {
    next(error);
  }
});

productsRouter.post('/:id/reviews', async (req, res, next) => {
  try {
    const payload = req.body as Partial<Review>;
    const review: Review = {
      id: payload.id ?? uuid(),
      productId: req.params.id,
      userId: payload.userId ?? 'demo-customer',
      rating: payload.rating ?? 5,
      title: payload.title ?? 'Great product',
      body: payload.body ?? 'Demo review submitted successfully.',
      createdAt: payload.createdAt ?? new Date().toISOString(),
    };
    await getCosmosService().addReview(review);
    res.status(201).json(review);
  } catch (error) {
    next(error);
  }
});
