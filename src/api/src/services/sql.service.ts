import sql, { ConnectionPool, IResult } from 'mssql';
import { appConfig, isSqlConfigured } from '../config';
import { sampleCustomers, sampleInventory, seedPricing } from '../data/seed-data';
import { Customer, Order, OrderItem, ProductPricing } from '../types';
import { getChaosService } from './chaos.service';
import { getTelemetryService } from './telemetry.service';

interface InventoryRow {
  productId: string;
  availableQuantity: number;
  warehouseRegion: string;
  lastUpdated: string;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const createSchemaSql = `
IF OBJECT_ID('dbo.Customers', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Customers (
    CustomerId NVARCHAR(50) PRIMARY KEY,
    Name NVARCHAR(200),
    Email NVARCHAR(200),
    CreatedAt DATETIME2
  )
END;
IF OBJECT_ID('dbo.CustomerAddresses', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.CustomerAddresses (
    AddressId NVARCHAR(50) PRIMARY KEY,
    CustomerId NVARCHAR(50),
    AddressLine1 NVARCHAR(200),
    City NVARCHAR(100),
    Country NVARCHAR(100),
    PostalCode NVARCHAR(20)
  )
END;
IF OBJECT_ID('dbo.Orders', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Orders (
    OrderId NVARCHAR(50) PRIMARY KEY,
    CustomerId NVARCHAR(50),
    OrderDate DATETIME2,
    Status NVARCHAR(50),
    TotalAmount DECIMAL(18,2),
    PaymentStatus NVARCHAR(50)
  )
END;
IF OBJECT_ID('dbo.OrderItems', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.OrderItems (
    OrderItemId NVARCHAR(50) PRIMARY KEY,
    OrderId NVARCHAR(50),
    ProductId NVARCHAR(100),
    Quantity INT,
    UnitPrice DECIMAL(18,2),
    LineTotal DECIMAL(18,2)
  )
END;
IF OBJECT_ID('dbo.ProductPricing', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ProductPricing (
    ProductId NVARCHAR(100) PRIMARY KEY,
    Currency NVARCHAR(10),
    ListPrice DECIMAL(18,2),
    SalePrice DECIMAL(18,2) NULL,
    EffectiveFrom DATETIME2,
    EffectiveTo DATETIME2 NULL
  )
END;
IF OBJECT_ID('dbo.InventorySummary', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.InventorySummary (
    ProductId NVARCHAR(100) PRIMARY KEY,
    AvailableQuantity INT,
    WarehouseRegion NVARCHAR(50),
    LastUpdated DATETIME2
  )
END;
IF OBJECT_ID('dbo.Promotions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Promotions (
    PromotionId NVARCHAR(50) PRIMARY KEY,
    Code NVARCHAR(50),
    DiscountPercent DECIMAL(5,2),
    Active BIT
  )
END;
`;

export class SqlService {
  private pool: ConnectionPool | null = null;
  private initialized = false;
  private readonly customers = new Map<string, Customer>(sampleCustomers.map((customer) => [customer.customerId, customer]));
  private readonly pricing = new Map<string, ProductPricing>(seedPricing.map((price) => [price.productId, price]));
  private readonly orders = new Map<string, Order>();
  private readonly inventory = new Map<string, InventoryRow>(sampleInventory.map((item) => [item.productId, item]));

  async getCustomer(customerId: string): Promise<Customer | null> {
    return this.runQuery('getCustomer', async () => {
      if (!isSqlConfigured()) {
        return this.customers.get(customerId) ?? null;
      }

      const request = (await this.getPool()).request();
      request.input('CustomerId', sql.NVarChar(50), customerId);
      const result = await request.query('SELECT CustomerId, Name, Email, CreatedAt FROM dbo.Customers WHERE CustomerId = @CustomerId');
      const row = result.recordset[0];
      return row
        ? { customerId: row.CustomerId, name: row.Name, email: row.Email, createdAt: new Date(row.CreatedAt).toISOString() }
        : null;
    });
  }

  async upsertCustomer(customer: Customer): Promise<void> {
    await this.runQuery('upsertCustomer', async () => {
      this.customers.set(customer.customerId, customer);
      if (!isSqlConfigured()) {
        return;
      }

      const request = (await this.getPool()).request();
      request.input('CustomerId', sql.NVarChar(50), customer.customerId);
      request.input('Name', sql.NVarChar(200), customer.name);
      request.input('Email', sql.NVarChar(200), customer.email);
      request.input('CreatedAt', sql.DateTime2, new Date(customer.createdAt));
      await request.query(`
        MERGE dbo.Customers AS target
        USING (SELECT @CustomerId AS CustomerId, @Name AS Name, @Email AS Email, @CreatedAt AS CreatedAt) AS source
          ON target.CustomerId = source.CustomerId
        WHEN MATCHED THEN UPDATE SET Name = source.Name, Email = source.Email, CreatedAt = source.CreatedAt
        WHEN NOT MATCHED THEN INSERT (CustomerId, Name, Email, CreatedAt) VALUES (source.CustomerId, source.Name, source.Email, source.CreatedAt);
      `);
    });
  }

  async getProductPricing(productId: string): Promise<ProductPricing | null> {
    return this.runQuery('getProductPricing', async () => {
      if (!isSqlConfigured()) {
        return this.pricing.get(productId) ?? null;
      }

      const request = (await this.getPool()).request();
      request.input('ProductId', sql.NVarChar(100), productId);
      const result = await request.query(
        'SELECT ProductId, Currency, ListPrice, SalePrice, EffectiveFrom, EffectiveTo FROM dbo.ProductPricing WHERE ProductId = @ProductId',
      );
      return this.mapPricing(result.recordset[0]);
    });
  }

  async getMultiplePricing(productIds: string[]): Promise<ProductPricing[]> {
    return this.runQuery('getMultiplePricing', async () => {
      if (productIds.length === 0) {
        return [];
      }

      if (!isSqlConfigured()) {
        return productIds.map((productId) => this.pricing.get(productId)).filter((value): value is ProductPricing => Boolean(value));
      }

      const request = (await this.getPool()).request();
      const parameterNames = productIds.map((productId, index) => {
        const name = `ProductId${index}`;
        request.input(name, sql.NVarChar(100), productId);
        return `@${name}`;
      });
      const result = await request.query(
        `SELECT ProductId, Currency, ListPrice, SalePrice, EffectiveFrom, EffectiveTo FROM dbo.ProductPricing WHERE ProductId IN (${parameterNames.join(', ')})`,
      );
      return result.recordset.map((row) => this.mapPricing(row)).filter((value): value is ProductPricing => Boolean(value));
    });
  }

  async createOrder(order: Order): Promise<void> {
    await this.runQuery('createOrder', async () => {
      this.orders.set(order.orderId, order);
      if (!isSqlConfigured()) {
        return;
      }

      const pool = await this.getPool();
      const transaction = new sql.Transaction(pool);
      await transaction.begin();

      try {
        const orderRequest = new sql.Request(transaction);
        orderRequest.input('OrderId', sql.NVarChar(50), order.orderId);
        orderRequest.input('CustomerId', sql.NVarChar(50), order.customerId);
        orderRequest.input('OrderDate', sql.DateTime2, new Date(order.orderDate));
        orderRequest.input('Status', sql.NVarChar(50), order.status);
        orderRequest.input('TotalAmount', sql.Decimal(18, 2), order.totalAmount);
        orderRequest.input('PaymentStatus', sql.NVarChar(50), order.paymentStatus);
        await orderRequest.query(`
          MERGE dbo.Orders AS target
          USING (SELECT @OrderId AS OrderId, @CustomerId AS CustomerId, @OrderDate AS OrderDate, @Status AS Status, @TotalAmount AS TotalAmount, @PaymentStatus AS PaymentStatus) AS source
            ON target.OrderId = source.OrderId
          WHEN MATCHED THEN UPDATE SET CustomerId = source.CustomerId, OrderDate = source.OrderDate, Status = source.Status, TotalAmount = source.TotalAmount, PaymentStatus = source.PaymentStatus
          WHEN NOT MATCHED THEN INSERT (OrderId, CustomerId, OrderDate, Status, TotalAmount, PaymentStatus)
            VALUES (source.OrderId, source.CustomerId, source.OrderDate, source.Status, source.TotalAmount, source.PaymentStatus);
        `);

        const deleteItemsRequest = new sql.Request(transaction);
        deleteItemsRequest.input('OrderId', sql.NVarChar(50), order.orderId);
        await deleteItemsRequest.query('DELETE FROM dbo.OrderItems WHERE OrderId = @OrderId');

        for (const item of order.items) {
          const itemRequest = new sql.Request(transaction);
          itemRequest.input('OrderItemId', sql.NVarChar(50), item.orderItemId);
          itemRequest.input('OrderId', sql.NVarChar(50), order.orderId);
          itemRequest.input('ProductId', sql.NVarChar(100), item.productId);
          itemRequest.input('Quantity', sql.Int, item.quantity);
          itemRequest.input('UnitPrice', sql.Decimal(18, 2), item.unitPrice);
          itemRequest.input('LineTotal', sql.Decimal(18, 2), item.lineTotal);
          await itemRequest.query(`
            INSERT INTO dbo.OrderItems (OrderItemId, OrderId, ProductId, Quantity, UnitPrice, LineTotal)
            VALUES (@OrderItemId, @OrderId, @ProductId, @Quantity, @UnitPrice, @LineTotal)
          `);
        }

        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    });
  }

  async getOrders(customerId: string): Promise<Order[]> {
    return this.runQuery('getOrders', async () => {
      if (!isSqlConfigured()) {
        return [...this.orders.values()].filter((order) => order.customerId === customerId);
      }

      const request = (await this.getPool()).request();
      request.input('CustomerId', sql.NVarChar(50), customerId);
      const orderResult = await request.query(
        'SELECT OrderId, CustomerId, OrderDate, Status, TotalAmount, PaymentStatus FROM dbo.Orders WHERE CustomerId = @CustomerId ORDER BY OrderDate DESC',
      );
      const orders = orderResult.recordset.map((row) => ({
        orderId: row.OrderId,
        customerId: row.CustomerId,
        orderDate: new Date(row.OrderDate).toISOString(),
        status: row.Status,
        totalAmount: Number(row.TotalAmount),
        paymentStatus: row.PaymentStatus,
        items: [] as OrderItem[],
      }));

      for (const order of orders) {
        order.items = await this.getOrderItems(order.orderId);
      }

      return orders;
    });
  }

  async getOrder(orderId: string): Promise<Order | null> {
    return this.runQuery('getOrder', async () => {
      if (!isSqlConfigured()) {
        return this.orders.get(orderId) ?? null;
      }

      const request = (await this.getPool()).request();
      request.input('OrderId', sql.NVarChar(50), orderId);
      const orderResult = await request.query(
        'SELECT OrderId, CustomerId, OrderDate, Status, TotalAmount, PaymentStatus FROM dbo.Orders WHERE OrderId = @OrderId',
      );
      const row = orderResult.recordset[0];
      if (!row) {
        return null;
      }

      return {
        orderId: row.OrderId,
        customerId: row.CustomerId,
        orderDate: new Date(row.OrderDate).toISOString(),
        status: row.Status,
        totalAmount: Number(row.TotalAmount),
        paymentStatus: row.PaymentStatus,
        items: await this.getOrderItems(orderId),
      };
    });
  }

  async getInventory(productId: string): Promise<number> {
    return this.runQuery('getInventory', async () => {
      if (!isSqlConfigured()) {
        return this.inventory.get(productId)?.availableQuantity ?? 0;
      }

      const request = (await this.getPool()).request();
      request.input('ProductId', sql.NVarChar(100), productId);
      const result = await request.query('SELECT AvailableQuantity FROM dbo.InventorySummary WHERE ProductId = @ProductId');
      return result.recordset[0]?.AvailableQuantity ?? 0;
    });
  }

  async upsertPricing(pricing: ProductPricing): Promise<void> {
    await this.runQuery('upsertPricing', async () => {
      this.pricing.set(pricing.productId, pricing);
      if (!isSqlConfigured()) {
        return;
      }

      const request = (await this.getPool()).request();
      request.input('ProductId', sql.NVarChar(100), pricing.productId);
      request.input('Currency', sql.NVarChar(10), pricing.currency);
      request.input('ListPrice', sql.Decimal(18, 2), pricing.listPrice);
      request.input('SalePrice', sql.Decimal(18, 2), pricing.salePrice ?? null);
      request.input('EffectiveFrom', sql.DateTime2, new Date(pricing.effectiveFrom));
      request.input('EffectiveTo', sql.DateTime2, pricing.effectiveTo ? new Date(pricing.effectiveTo) : null);
      await request.query(`
        MERGE dbo.ProductPricing AS target
        USING (SELECT @ProductId AS ProductId, @Currency AS Currency, @ListPrice AS ListPrice, @SalePrice AS SalePrice, @EffectiveFrom AS EffectiveFrom, @EffectiveTo AS EffectiveTo) AS source
          ON target.ProductId = source.ProductId
        WHEN MATCHED THEN UPDATE SET Currency = source.Currency, ListPrice = source.ListPrice, SalePrice = source.SalePrice, EffectiveFrom = source.EffectiveFrom, EffectiveTo = source.EffectiveTo
        WHEN NOT MATCHED THEN INSERT (ProductId, Currency, ListPrice, SalePrice, EffectiveFrom, EffectiveTo)
          VALUES (source.ProductId, source.Currency, source.ListPrice, source.SalePrice, source.EffectiveFrom, source.EffectiveTo);
      `);
    });
  }

  async upsertInventory(productId: string, availableQuantity: number, warehouseRegion: string): Promise<void> {
    await this.runQuery('upsertInventory', async () => {
      this.inventory.set(productId, {
        productId,
        availableQuantity,
        warehouseRegion,
        lastUpdated: new Date().toISOString(),
      });

      if (!isSqlConfigured()) {
        return;
      }

      const request = (await this.getPool()).request();
      request.input('ProductId', sql.NVarChar(100), productId);
      request.input('AvailableQuantity', sql.Int, availableQuantity);
      request.input('WarehouseRegion', sql.NVarChar(50), warehouseRegion);
      request.input('LastUpdated', sql.DateTime2, new Date());
      await request.query(`
        MERGE dbo.InventorySummary AS target
        USING (SELECT @ProductId AS ProductId, @AvailableQuantity AS AvailableQuantity, @WarehouseRegion AS WarehouseRegion, @LastUpdated AS LastUpdated) AS source
          ON target.ProductId = source.ProductId
        WHEN MATCHED THEN UPDATE SET AvailableQuantity = source.AvailableQuantity, WarehouseRegion = source.WarehouseRegion, LastUpdated = source.LastUpdated
        WHEN NOT MATCHED THEN INSERT (ProductId, AvailableQuantity, WarehouseRegion, LastUpdated)
          VALUES (source.ProductId, source.AvailableQuantity, source.WarehouseRegion, source.LastUpdated);
      `);
    });
  }

  async healthCheck(): Promise<boolean> {
    if (!isSqlConfigured()) {
      return true;
    }

    try {
      const pool = await this.getPool();
      await pool.request().query('SELECT 1 AS Healthy');
      return true;
    } catch {
      return false;
    }
  }

  private async getPool(): Promise<ConnectionPool> {
    if (!isSqlConfigured()) {
      throw new Error('SQL configuration missing.');
    }

    if (!this.pool) {
      this.pool = await new sql.ConnectionPool({
        server: appConfig.sqlServer,
        database: appConfig.sqlDatabase,
        user: appConfig.sqlUser,
        password: appConfig.sqlPassword,
        options: {
          encrypt: true,
          trustServerCertificate: false,
        },
        pool: {
          max: 10,
          min: 0,
          idleTimeoutMillis: 30000,
        },
      }).connect();
    }

    if (!this.initialized) {
      await this.pool.request().query(createSchemaSql);
      this.initialized = true;
    }

    return this.pool;
  }

  private async getOrderItems(orderId: string): Promise<OrderItem[]> {
    if (!isSqlConfigured()) {
      return this.orders.get(orderId)?.items ?? [];
    }

    const request = (await this.getPool()).request();
    request.input('OrderId', sql.NVarChar(50), orderId);
    const itemsResult = await request.query(
      'SELECT OrderItemId, OrderId, ProductId, Quantity, UnitPrice, LineTotal FROM dbo.OrderItems WHERE OrderId = @OrderId ORDER BY OrderItemId',
    );
    return itemsResult.recordset.map((row) => ({
      orderItemId: row.OrderItemId,
      orderId: row.OrderId,
      productId: row.ProductId,
      quantity: row.Quantity,
      unitPrice: Number(row.UnitPrice),
      lineTotal: Number(row.LineTotal),
    }));
  }

  private mapPricing(row: Record<string, unknown> | undefined): ProductPricing | null {
    if (!row) {
      return null;
    }

    return {
      productId: String(row.ProductId),
      currency: String(row.Currency),
      listPrice: Number(row.ListPrice),
      salePrice: row.SalePrice === null ? null : Number(row.SalePrice),
      effectiveFrom: new Date(String(row.EffectiveFrom)).toISOString(),
      effectiveTo: row.EffectiveTo ? new Date(String(row.EffectiveTo)).toISOString() : null,
    };
  }

  private async runQuery<T>(operationType: string, action: () => Promise<T>): Promise<T> {
    const start = Date.now();
    const chaos = getChaosService().getState();
    let statusCode = 200;

    try {
      if (chaos.sqlSlowQuery) {
        await delay(2000);
      }

      const result = await action();

      if (chaos.sqlConnectionPressure) {
        await delay(5000);
      }

      getTelemetryService().recordOperation({
        timestamp: new Date().toISOString(),
        source: 'sql',
        operationType,
        latencyMs: Date.now() - start,
        statusCode: chaos.sqlSlowQuery || chaos.sqlConnectionPressure ? 503 : statusCode,
      });
      return result;
    } catch (error) {
      statusCode = 500;
      getTelemetryService().recordOperation({
        timestamp: new Date().toISOString(),
        source: 'sql',
        operationType,
        latencyMs: Date.now() - start,
        statusCode,
      });
      throw error;
    }
  }
}

let sqlServiceSingleton: SqlService | undefined;

export const getSqlService = (): SqlService => {
  if (!sqlServiceSingleton) {
    sqlServiceSingleton = new SqlService();
  }

  return sqlServiceSingleton;
};
