import { Container, CosmosClient, Database } from '@azure/cosmos';
import { AsyncLocalStorage } from 'node:async_hooks';
import { v4 as uuid } from 'uuid';
import { appConfig, isCosmosConfigured } from '../config';
import { seedProducts, sampleReviews } from '../data/seed-data';
import { Cart, ChaosState, DemoEvent, Product, Review, SreAgentReport } from '../types';
import { COSMOS_PRESSURE_TOGGLES, getChaosService } from './chaos.service';
import { getTelemetryService } from './telemetry.service';

const LARGE_PADDING = 'x'.repeat(50000);

/**
 * Collects the RU charges Azure Cosmos DB reports for the operation currently
 * in flight. Request handling interleaves, so the accumulator is carried in
 * async context rather than on the instance, which would let concurrent
 * requests bill each other.
 */
const ruTracker = new AsyncLocalStorage<{ charge: number }>();

/** Adds a Cosmos response's measured RU charge to the operation in flight. */
const trackRu = <T extends { requestCharge?: number }>(response: T): T => {
  const store = ruTracker.getStore();
  if (store && typeof response.requestCharge === 'number') {
    store.charge += response.requestCharge;
  }

  return response;
};

/** Raised when Azure Cosmos DB genuinely throttles a request (HTTP 429). */
export class CosmosThrottledError extends Error {
  readonly statusCode = 429;

  constructor(operationName: string) {
    super(`Cosmos DB throttled the '${operationName}' operation (429 Too Many Requests).`);
    this.name = 'CosmosThrottledError';
  }
}

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
        const { resources } = trackRu(await container.items.query<Product>({ query: 'SELECT * FROM c' }).fetchAll());
        return categoryId ? resources.filter((product) => product.categoryId === categoryId) : resources;
      }

      const { resources } = trackRu(
        await container.items
          .query<Product>({
            query: 'SELECT * FROM c WHERE c.categoryId = @categoryId',
            parameters: [{ name: '@categoryId', value: categoryId }],
          })
          .fetchAll(),
      );
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
        const { resources } = trackRu(
          await container.items
            .query<Product>({ query: 'SELECT * FROM c WHERE c.id = @id', parameters: [{ name: '@id', value: id }] })
            .fetchAll(),
        );
        return resources[0] ?? null;
      }

      const product = seedProducts.find((item) => item.id === id);
      if (!product) {
        return null;
      }

      const response = trackRu(
        await container.item(id, this.shouldUseNoIndexContainer() ? id : product.categoryId).read<Product>(),
      );
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
      trackRu(await indexedContainer.items.upsert(payload));
      trackRu(await noIndexContainer.items.upsert({ ...payload, id: product.id }));
    });
  }

  async getCart(userId: string): Promise<Cart | null> {
    return this.runOperation('getCart', userId, async () => {
      if (!isCosmosConfigured()) {
        return this.inMemoryCarts.get(userId) ?? null;
      }

      await this.ensureInitialized();
      const container = await this.getContainer('carts');
      const response = trackRu(await container.item(userId, userId).read<Cart>());
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
      // Carts are the document the demo writes continuously, so this is where an
      // oversized document actually costs something. Padding only the catalogue
      // write path left the scenario with no measurable effect, because nothing
      // in the running workload writes products.
      trackRu(await container.items.upsert(this.decorateDocument({ ...cart, id: cart.userId })));
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
      const { resources } = trackRu(
        await container.items
          .query<Review>({ query: 'SELECT * FROM c WHERE c.productId = @productId', parameters: [{ name: '@productId', value: productId }] })
          .fetchAll(),
      );
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
      trackRu(await container.items.upsert(review));
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
      trackRu(await container.items.upsert({ ...report, id: report.incidentId, incidentId: report.incidentId }));
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
      trackRu(await container.items.upsert(event));
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

  /**
   * Applies the oversized-document anti-pattern to a document the demo writes.
   *
   * Cosmos charges RU in proportion to document size, so padding a document to
   * ~52KB makes the write genuinely expensive and inflates every subsequent
   * read of it. The cost is therefore real and visible in the RU the service
   * reports, rather than being asserted by the application.
   */
  private decorateDocument<T extends object>(document: T): T & { padding?: string } {
    if (getChaosService().getState().largeDocument) {
      return { ...document, padding: LARGE_PADDING };
    }

    return document as T & { padding?: string };
  }

  private decorateProductDocument(product: Product): Product & { padding?: string } {
    return this.decorateDocument(product);
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

  /**
   * RU figure used only when there is no Azure Cosmos DB to bill us - the local
   * in-memory mode the kit falls back to when Cosmos is not configured. When
   * Cosmos is configured the snapshot carries the charges Azure actually
   * reported, so the demo never shows a number the portal would contradict.
   */
  private inMemoryRuEstimate(chaos: ChaosState): number {
    let ruCharge = 5;

    if (COSMOS_PRESSURE_TOGGLES.some((toggle) => chaos[toggle])) {
      ruCharge += 25;
    }

    if (chaos.largeDocument) {
      ruCharge += 40;
    }

    return ruCharge;
  }

  private async runOperation<T>(operationName: string, partitionKey: string, action: () => Promise<T>): Promise<T> {
    const store = { charge: 0 };

    return ruTracker.run(store, async () => {
      const start = Date.now();
      const chaos = getChaosService().getState();
      let statusCode = 200;

      try {
        await this.getClientForOperation();

        if (chaos.metadataThrottling && isCosmosConfigured()) {
          const container = await this.getProductsContainer();
          trackRu(await container.read());
        }

        // Against a real Cosmos account the 429s come from the service itself,
        // so a status code is only forged in local in-memory mode where there
        // is nothing to throttle us.
        if (!isCosmosConfigured() && COSMOS_PRESSURE_TOGGLES.some((toggle) => chaos[toggle])) {
          statusCode = 429;
        }

        const actionStart = Date.now();
        const result = await action();
        const serviceLatencyMs = Date.now() - actionStart;

        const ruCharge = isCosmosConfigured()
          ? Math.round(store.charge * 100) / 100
          : this.inMemoryRuEstimate(chaos);

        getTelemetryService().recordOperation({
          timestamp: new Date().toISOString(),
          source: 'cosmos',
          operationType: operationName,
          latencyMs: Date.now() - start,
          ruCharge,
          statusCode,
          partitionKey: chaos.hotPartition ? 'hot-category' : partitionKey,
          serviceLatencyMs,
        });

        return result;
      } catch (error) {
        // Surface genuine Cosmos throttling: the SDK reports 429 (TooManyRequests)
        // with the RU charge that was actually attempted.
        const cosmosError = error as { code?: number | string; statusCode?: number; requestCharge?: number };
        const rawCode = Number(cosmosError.statusCode ?? cosmosError.code);
        const observedStatus = Number.isFinite(rawCode) && rawCode > 0 ? rawCode : 500;

        getTelemetryService().recordOperation({
          timestamp: new Date().toISOString(),
          source: 'cosmos',
          operationType: operationName,
          latencyMs: Date.now() - start,
          ruCharge: cosmosError.requestCharge ?? Math.round(store.charge * 100) / 100,
          statusCode: observedStatus,
          partitionKey: chaos.hotPartition ? 'hot-category' : partitionKey,
        });

        // A throttled read is a degraded response, not an outage - the demo app
        // stays up and the 429 is recorded as evidence for the SRE Agent.
        if (observedStatus === 429) {
          throw new CosmosThrottledError(operationName);
        }

        throw error;
      }
    });
  }
}

let cosmosServiceSingleton: CosmosService | undefined;

export const getCosmosService = (): CosmosService => {
  if (!cosmosServiceSingleton) {
    cosmosServiceSingleton = new CosmosService();
  }

  return cosmosServiceSingleton;
};
