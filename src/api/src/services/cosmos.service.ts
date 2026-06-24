import { Container, CosmosClient, Database } from '@azure/cosmos';
import { v4 as uuid } from 'uuid';
import { appConfig, isCosmosConfigured } from '../config';
import { seedProducts, sampleReviews } from '../data/seed-data';
import { Cart, DemoEvent, Product, Review, SreAgentReport } from '../types';
import { getChaosService } from './chaos.service';
import { getTelemetryService } from './telemetry.service';

const LARGE_PADDING = 'x'.repeat(50000);
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const createContainerDefinitions = () => [
  { id: 'products', partitionKey: { paths: ['/categoryId'] } },
  { id: 'carts', partitionKey: { paths: ['/userId'] } },
  { id: 'UserEvents', partitionKey: { paths: ['/userId'] }, defaultTtl: 86400 },
  { id: 'Recommendations', partitionKey: { paths: ['/userId'] } },
  { id: 'Reviews', partitionKey: { paths: ['/productId'] } },
  { id: 'SreInvestigations', partitionKey: { paths: ['/incidentId'] } },
  { id: 'ProductsNoIndex', partitionKey: { paths: ['/id'] }, indexingPolicy: { indexingMode: 'none' } },
  { id: 'DemoTelemetry', partitionKey: { paths: ['/partitionKey'] }, defaultTtl: 86400 },
];

export class CosmosService {
  private client: CosmosClient | null = null;
  private database: Database | null = null;
  private initialized = false;
  private readonly inMemoryProducts = new Map<string, Product>(seedProducts.map((product) => [product.id, product]));
  private readonly inMemoryProductsNoIndex = new Map<string, Product>(seedProducts.map((product) => [product.id, product]));
  private readonly inMemoryCarts = new Map<string, Cart>();
  private readonly inMemoryReviews = new Map<string, Review[]>([]);
  private readonly inMemoryInvestigations = new Map<string, SreAgentReport>();
  private readonly inMemoryEvents: DemoEvent[] = [];

  constructor() {
    sampleReviews.forEach((review) => {
      const reviews = this.inMemoryReviews.get(review.productId) ?? [];
      reviews.push(review);
      this.inMemoryReviews.set(review.productId, reviews);
    });
  }

  async getProducts(categoryId?: string): Promise<Product[]> {
    return this.runOperation('getProducts', categoryId ?? 'all-products', async () => {
      if (!isCosmosConfigured()) {
        const source = this.shouldUseNoIndexContainer() ? this.inMemoryProductsNoIndex : this.inMemoryProducts;
        const products = [...source.values()];
        return categoryId ? products.filter((product) => product.categoryId === categoryId) : products;
      }

      await this.ensureInitialized();
      const container = await this.getProductsContainer();
      const chaos = getChaosService().getState();

      if (chaos.crossPartitionQuery || !categoryId) {
        const { resources } = await container.items.query<Product>({ query: 'SELECT * FROM c' }).fetchAll();
        return categoryId ? resources.filter((product) => product.categoryId === categoryId) : resources;
      }

      const { resources } = await container.items
        .query<Product>({
          query: 'SELECT * FROM c WHERE c.categoryId = @categoryId',
          parameters: [{ name: '@categoryId', value: categoryId }],
        })
        .fetchAll();
      return resources;
    });
  }

  async getProduct(id: string): Promise<Product | null> {
    return this.runOperation('getProduct', id, async () => {
      if (!isCosmosConfigured()) {
        const source = this.shouldUseNoIndexContainer() ? this.inMemoryProductsNoIndex : this.inMemoryProducts;
        return source.get(id) ?? null;
      }

      await this.ensureInitialized();
      const container = await this.getProductsContainer();
      const chaos = getChaosService().getState();

      if (chaos.pointReadMisuse) {
        const { resources } = await container.items
          .query<Product>({ query: 'SELECT * FROM c WHERE c.id = @id', parameters: [{ name: '@id', value: id }] })
          .fetchAll();
        return resources[0] ?? null;
      }

      const product = seedProducts.find((item) => item.id === id);
      if (!product) {
        return null;
      }

      const response = await container.item(id, this.shouldUseNoIndexContainer() ? id : product.categoryId).read<Product>();
      return response.resource ?? null;
    });
  }

  async upsertProduct(product: Product): Promise<void> {
    await this.runOperation('upsertProduct', product.categoryId, async () => {
      const payload = this.decorateProductDocument(product);
      this.inMemoryProducts.set(product.id, product);
      this.inMemoryProductsNoIndex.set(product.id, product);

      if (!isCosmosConfigured()) {
        return;
      }

      await this.ensureInitialized();
      const indexedContainer = await this.getContainer('products');
      const noIndexContainer = await this.getContainer('ProductsNoIndex');
      await indexedContainer.items.upsert(payload);
      await noIndexContainer.items.upsert({ ...payload, id: product.id });
    });
  }

  async getCart(userId: string): Promise<Cart | null> {
    return this.runOperation('getCart', userId, async () => {
      if (!isCosmosConfigured()) {
        return this.inMemoryCarts.get(userId) ?? null;
      }

      await this.ensureInitialized();
      const container = await this.getContainer('carts');
      const response = await container.item(userId, userId).read<Cart>();
      return response.resource ?? null;
    });
  }

  async upsertCart(cart: Cart): Promise<void> {
    await this.runOperation('upsertCart', cart.userId, async () => {
      this.inMemoryCarts.set(cart.userId, cart);
      if (!isCosmosConfigured()) {
        return;
      }

      await this.ensureInitialized();
      const container = await this.getContainer('carts');
      await container.items.upsert({ ...cart, id: cart.userId });
    });
  }

  async deleteCartItem(userId: string, productId: string): Promise<void> {
    await this.runOperation('deleteCartItem', userId, async () => {
      const cart = (await this.getCart(userId)) ?? { id: userId, userId, items: [], updatedAt: new Date().toISOString() };
      cart.items = cart.items.filter((item) => item.productId !== productId);
      cart.updatedAt = new Date().toISOString();
      await this.upsertCart(cart);
    });
  }

  async getReviews(productId: string): Promise<Review[]> {
    return this.runOperation('getReviews', productId, async () => {
      if (!isCosmosConfigured()) {
        return this.inMemoryReviews.get(productId) ?? [];
      }

      await this.ensureInitialized();
      const container = await this.getContainer('Reviews');
      const { resources } = await container.items
        .query<Review>({ query: 'SELECT * FROM c WHERE c.productId = @productId', parameters: [{ name: '@productId', value: productId }] })
        .fetchAll();
      return resources;
    });
  }

  async addReview(review: Review): Promise<void> {
    await this.runOperation('addReview', review.productId, async () => {
      const reviews = this.inMemoryReviews.get(review.productId) ?? [];
      reviews.push(review);
      this.inMemoryReviews.set(review.productId, reviews);

      if (!isCosmosConfigured()) {
        return;
      }

      await this.ensureInitialized();
      const container = await this.getContainer('Reviews');
      await container.items.upsert(review);
    });
  }

  async saveInvestigation(report: SreAgentReport): Promise<void> {
    await this.runOperation('saveInvestigation', report.incidentId, async () => {
      this.inMemoryInvestigations.set(report.incidentId, report);

      if (!isCosmosConfigured()) {
        return;
      }

      await this.ensureInitialized();
      const container = await this.getContainer('SreInvestigations');
      await container.items.upsert({ ...report, id: report.incidentId, incidentId: report.incidentId });
    });
  }

  async logDemoEvent(event: DemoEvent): Promise<void> {
    await this.runOperation('logDemoEvent', event.partitionKey, async () => {
      this.inMemoryEvents.push(event);
      getTelemetryService().recordDemoEvent(event);

      if (!isCosmosConfigured()) {
        return;
      }

      await this.ensureInitialized();
      const container = await this.getContainer('DemoTelemetry');
      await container.items.upsert(event);
    });
  }

  async healthCheck(): Promise<boolean> {
    if (!isCosmosConfigured()) {
      return true;
    }

    try {
      await this.ensureInitialized();
      await (await this.getContainer('products')).read();
      return true;
    } catch {
      return false;
    }
  }

  private decorateProductDocument(product: Product): Product & { padding?: string } {
    if (getChaosService().getState().largeDocument) {
      return { ...product, padding: LARGE_PADDING };
    }

    return product;
  }

  private shouldUseNoIndexContainer(): boolean {
    return getChaosService().getState().missingIndexing;
  }

  private async ensureInitialized(): Promise<void> {
    if (!isCosmosConfigured() || this.initialized) {
      return;
    }

    this.client = new CosmosClient({ endpoint: appConfig.cosmosEndpoint, key: appConfig.cosmosKey });
    const { database } = await this.client.databases.createIfNotExists({ id: appConfig.cosmosDatabaseId });
    this.database = database;

    for (const definition of createContainerDefinitions()) {
      await this.database.containers.createIfNotExists(definition as never);
    }

    this.initialized = true;
  }

  private async getContainer(containerName: string): Promise<Container> {
    await this.ensureInitialized();
    if (!this.database) {
      throw new Error('Cosmos database is not initialized.');
    }

    return this.database.container(containerName);
  }

  private async getProductsContainer(): Promise<Container> {
    if (this.shouldUseNoIndexContainer()) {
      return this.getContainer('ProductsNoIndex');
    }

    return this.getContainer('products');
  }

  private async getClientForOperation(): Promise<CosmosClient | null> {
    if (!isCosmosConfigured()) {
      return null;
    }

    if (getChaosService().getState().multipleClients) {
      return new CosmosClient({ endpoint: appConfig.cosmosEndpoint, key: appConfig.cosmosKey });
    }

    await this.ensureInitialized();
    return this.client;
  }

  private async runOperation<T>(operationName: string, partitionKey: string, action: () => Promise<T>): Promise<T> {
    const start = Date.now();
    const chaos = getChaosService().getState();
    let statusCode = 200;
    let ruCharge = 5;

    try {
      await this.getClientForOperation();

      if (chaos.metadataThrottling && isCosmosConfigured()) {
        const container = await this.getProductsContainer();
        await container.read();
      }

      if (chaos.hotPartition || chaos.multipleClients || chaos.crossPartitionQuery || chaos.missingIndexing || chaos.pointReadMisuse) {
        statusCode = 429;
        ruCharge += 25;
      }

      if (chaos.largeDocument) {
        ruCharge += 40;
      }

      const additionalLatency =
        (chaos.metadataThrottling ? 90 : 0)
        + (chaos.multipleClients ? 60 : 0)
        + (chaos.hotPartition ? 140 : 0)
        + (chaos.crossPartitionQuery ? 80 : 0)
        + (chaos.missingIndexing ? 120 : 0)
        + (chaos.pointReadMisuse ? 45 : 0)
        + (chaos.largeDocument ? 70 : 0);

      if (additionalLatency > 0) {
        await delay(additionalLatency);
      }

      const result = await action();
      getTelemetryService().recordOperation({
        timestamp: new Date().toISOString(),
        source: 'cosmos',
        operationType: operationName,
        latencyMs: Date.now() - start,
        ruCharge,
        statusCode,
        partitionKey: chaos.hotPartition ? 'hot-category' : partitionKey,
      });

      return result;
    } catch (error) {
      getTelemetryService().recordOperation({
        timestamp: new Date().toISOString(),
        source: 'cosmos',
        operationType: operationName,
        latencyMs: Date.now() - start,
        ruCharge,
        statusCode: 500,
        partitionKey,
      });
      throw error;
    }
  }
}

let cosmosServiceSingleton: CosmosService | undefined;

export const getCosmosService = (): CosmosService => {
  if (!cosmosServiceSingleton) {
    cosmosServiceSingleton = new CosmosService();
  }

  return cosmosServiceSingleton;
};
