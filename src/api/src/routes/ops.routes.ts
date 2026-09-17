import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getChaosService } from '../services/chaos.service';
import { getCosmosService } from '../services/cosmos.service';
import { getSqlService } from '../services/sql.service';
import { getTelemetryService } from '../services/telemetry.service';
import { Order } from '../types';

export const opsRouter = Router();

let loadInterval: NodeJS.Timeout | null = null;
let loadRps = 0;
// Guards against overlapping load ticks. Under an active incident a single
// tick can take far longer than the tick interval, and without this guard the
// generator keeps queueing new work on top of unfinished work. That backlog
// compounds until reported latency reflects queue depth rather than real
// service latency, and the event loop starves.
let tickInFlight = false;

const runSyntheticCheckout = async (): Promise<void> => {
  const startedAt = Date.now();
  const cosmosService = getCosmosService();
  const sqlService = getSqlService();
  const pricing = await sqlService.getProductPricing('phone-001');
  const unitPrice = pricing?.salePrice ?? pricing?.listPrice ?? 799;
  const userId = 'demo-customer';
  await cosmosService.upsertCart({
    id: userId,
    userId,
    items: [{ productId: 'phone-001', productName: 'Smartphone X15', quantity: 1, unitPrice }],
    updatedAt: new Date().toISOString(),
  });

  const order: Order = {
    orderId: uuid(),
    customerId: userId,
    orderDate: new Date().toISOString(),
    status: 'confirmed',
    totalAmount: unitPrice,
    paymentStatus: 'completed',
    items: [
      {
        orderItemId: uuid(),
        orderId: uuid(),
        productId: 'phone-001',
        quantity: 1,
        unitPrice,
        lineTotal: unitPrice,
      },
    ],
  };
  order.items[0].orderId = order.orderId;
  await sqlService.createOrder(order);
  getTelemetryService().recordOperation({
    timestamp: new Date().toISOString(),
    source: 'app',
    operationType: 'checkout',
    // Measured, not assumed: this is the signal the checkout success rate and
    // p99 latency are derived from.
    latencyMs: Date.now() - startedAt,
    statusCode: 201,
  });
};

opsRouter.get('/', (_req, res) => {
  const telemetrySnapshot = getTelemetryService().getSnapshot();
  res.json({
    chaosState: getChaosService().getState(),
    telemetrySnapshot,
    activeIncident: telemetrySnapshot.latencyP99Ms > 500 || telemetrySnapshot.activeToggles.length > 0 || telemetrySnapshot.cosmos429Count > 0,
    loadGenerator: { running: Boolean(loadInterval), rps: loadRps },
    timestamp: new Date().toISOString(),
  });
});

opsRouter.post('/load/start', (_req, res) => {
  if (!loadInterval) {
    loadRps = 12;
    loadInterval = setInterval(async () => {
      // Skip this tick if the previous one has not finished. A saturated
      // system should serve fewer requests, not accumulate an ever growing
      // backlog.
      if (tickInFlight) {
        return;
      }

      tickInFlight = true;
      const startedAt = Date.now();

      try {
        for (let index = 0; index < 10; index += 1) {
          await getCosmosService().getProduct(index % 2 === 0 ? 'laptop-001' : 'phone-001');
        }
        await runSyntheticCheckout();
        await runSyntheticCheckout();
      } catch {
        getTelemetryService().recordOperation({
          timestamp: new Date().toISOString(),
          source: 'app',
          operationType: 'checkout',
          latencyMs: Date.now() - startedAt,
          statusCode: 500,
        });
      } finally {
        tickInFlight = false;
      }
    }, 1000);
  }

  res.status(202).json({ running: true, rps: loadRps });
});

opsRouter.post('/load/stop', (_req, res) => {
  if (loadInterval) {
    clearInterval(loadInterval);
    loadInterval = null;
  }
  tickInFlight = false;
  loadRps = 0;
  res.json({ running: false, rps: loadRps });
});
