import { seedProducts, seedPricing, sampleCustomers, sampleInventory } from './seed-data';
import { getCosmosService } from '../services/cosmos.service';
import { getSqlService } from '../services/sql.service';

const mode = process.argv[2] ?? 'all';

const seedCosmos = async (): Promise<void> => {
  const cosmosService = getCosmosService();
  for (const product of seedProducts) {
    await cosmosService.upsertProduct(product);
  }
};

const seedSql = async (): Promise<void> => {
  const sqlService = getSqlService();
  for (const pricing of seedPricing) {
    await sqlService.upsertPricing(pricing);
  }
  for (const customer of sampleCustomers) {
    await sqlService.upsertCustomer(customer);
  }
  for (const inventory of sampleInventory) {
    await sqlService.upsertInventory(inventory.productId, inventory.availableQuantity, inventory.warehouseRegion);
  }
};

(async () => {
  if (mode === 'cosmos' || mode === 'all') {
    await seedCosmos();
  }

  if (mode === 'sql' || mode === 'all') {
    await seedSql();
  }

  console.log('seed complete');
})().catch((error) => {
  console.error('seed failed', error);
  process.exit(1);
});
