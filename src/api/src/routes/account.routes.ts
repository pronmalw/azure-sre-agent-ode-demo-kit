import { Router } from 'express';
import { getSqlService } from '../services/sql.service';
import { Customer } from '../types';

export const accountRouter = Router();

accountRouter.get('/:customerId', async (req, res, next) => {
  try {
    const customer = await getSqlService().getCustomer(req.params.customerId);
    if (!customer) {
      res.status(404).json({ message: 'Customer not found' });
      return;
    }
    res.json(customer);
  } catch (error) {
    next(error);
  }
});

accountRouter.put('/:customerId', async (req, res, next) => {
  try {
    const payload = req.body as Partial<Customer>;
    const customer: Customer = {
      customerId: req.params.customerId,
      name: payload.name ?? 'Demo Customer',
      email: payload.email ?? 'demo@contoso.demo',
      createdAt: payload.createdAt ?? new Date().toISOString(),
    };
    await getSqlService().upsertCustomer(customer);
    res.json(customer);
  } catch (error) {
    next(error);
  }
});
