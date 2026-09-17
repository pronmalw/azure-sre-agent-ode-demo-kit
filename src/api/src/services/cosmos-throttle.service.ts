import { CosmosClient, Container } from '@azure/cosmos';
import { appConfig, isThrottleProbeConfigured } from '../config';
import { getTelemetryService } from './telemetry.service';

/**
 * Generates genuine Azure Cosmos DB throttling (HTTP 429).
 *
 * The main application account is serverless, which cannot be constrained to a
 * low RU ceiling, so real throttling is impossible there. This service drives
 * concurrent writes at a single partition key on a dedicated container that is
 * provisioned at the 400 RU/s minimum. Exceeding that budget makes Cosmos return
 * real 429s with real RU charges and retry-after hints, which is what the Azure
 * SRE Agent reads from Azure Monitor.
 */

const BURST_INTERVAL_MS = 1_000;
const WRITES_PER_BURST = 60;
const HOT_PARTITION_KEY = 'hot-category';

export class CosmosThrottleService {
  private client: CosmosClient | null = null;
  private container: Container | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  isEnabled(): boolean {
    return isThrottleProbeConfigured();
  }

  setEnabled(enabled: boolean): void {
    if (!this.isEnabled()) {
      return;
    }

    if (enabled) {
      this.start();
    } else {
      this.stop();
    }
  }

  private getContainer(): Container {
    if (!this.client) {
      this.client = new CosmosClient({
        endpoint: appConfig.throttleCosmosEndpoint,
        key: appConfig.throttleCosmosKey,
        // The SDK retries throttled requests internally by default, which would
        // hide the 429s we are deliberately trying to observe.
        connectionPolicy: {
          retryOptions: {
            maxRetryAttemptCount: 0,
            fixedRetryIntervalInMilliseconds: 0,
            maxWaitTimeInSeconds: 1,
          },
        },
      });
    }

    if (!this.container) {
      this.container = this.client
        .database(appConfig.throttleCosmosDatabaseId)
        .container(appConfig.throttleCosmosContainerId);
    }

    return this.container;
  }

  private start(): void {
    if (this.timer) {
      return;
    }

    console.log('[cosmos-throttle] driving real RU exhaustion against the 400 RU/s container.');
    this.timer = setInterval(() => {
      if (this.running) {
        return;
      }

      this.running = true;
      void this.burst().finally(() => {
        this.running = false;
      });
    }, BURST_INTERVAL_MS);
    this.timer.unref?.();
  }

  private stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
    console.log('[cosmos-throttle] stopped RU exhaustion.');
  }

  /**
   * Fires a burst of concurrent single-partition writes. All writes target the
   * same partition key so the RU budget for that physical partition is exhausted.
   */
  private async burst(): Promise<void> {
    const container = this.getContainer();
    const telemetry = getTelemetryService();

    const writes = Array.from({ length: WRITES_PER_BURST }, async () => {
      const start = Date.now();
      try {
        const response = await container.items.create(
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            pk: HOT_PARTITION_KEY,
            // Padding increases the RU cost per write so the 400 RU/s ceiling is
            // reached quickly and predictably during a demo.
            payload: 'x'.repeat(2048),
            createdAt: new Date().toISOString(),
          },
          { disableAutomaticIdGeneration: true },
        );

        telemetry.recordOperation({
          timestamp: new Date().toISOString(),
          source: 'cosmos',
          operationType: 'throttleProbeWrite',
          latencyMs: Date.now() - start,
          ruCharge: response.requestCharge,
          statusCode: 200,
          partitionKey: HOT_PARTITION_KEY,
        });
      } catch (error) {
        const cosmosError = error as { code?: number | string; statusCode?: number; requestCharge?: number };
        const rawCode = Number(cosmosError.statusCode ?? cosmosError.code);
        const statusCode = Number.isFinite(rawCode) && rawCode > 0 ? rawCode : 500;

        telemetry.recordOperation({
          timestamp: new Date().toISOString(),
          source: 'cosmos',
          operationType: 'throttleProbeWrite',
          latencyMs: Date.now() - start,
          ruCharge: cosmosError.requestCharge ?? 0,
          statusCode,
          partitionKey: HOT_PARTITION_KEY,
        });
      }
    });

    await Promise.all(writes);
  }
}

let throttleSingleton: CosmosThrottleService | undefined;

export const getCosmosThrottleService = (): CosmosThrottleService => {
  if (!throttleSingleton) {
    throttleSingleton = new CosmosThrottleService();
  }

  return throttleSingleton;
};
