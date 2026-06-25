import * as applicationInsights from 'applicationinsights';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { appConfig } from './config';
import { accountRouter } from './routes/account.routes';
import { cartRouter } from './routes/cart.routes';
import { chaosRouter } from './routes/chaos.routes';
import { healthRouter } from './routes/health.routes';
import { opsRouter } from './routes/ops.routes';
import { ordersRouter } from './routes/orders.routes';
import { productsRouter } from './routes/products.routes';
import { sreAgentRouter } from './routes/sre-agent.routes';

let appInsightsStarted = false;

export const createApp = () => {
  if (appConfig.appInsightsConnectionString && !appInsightsStarted) {
    applicationInsights.setup(appConfig.appInsightsConnectionString).setAutoCollectConsole(true, true).start();
    appInsightsStarted = true;
  }

  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors());
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan(appConfig.nodeEnv === 'production' ? 'combined' : 'dev'));

  app.get('/', (_req, res) => {
    res.json({ name: 'Contoso Retail API', status: 'ok' });
  });

  app.use('/health', healthRouter);
  app.use('/api/health', healthRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/cart', cartRouter);
  app.use('/api/account', accountRouter);
  app.use('/api/chaos', chaosRouter);
  app.use('/api/ops', opsRouter);
  app.use('/api', ordersRouter);
  app.use('/sre-agent', sreAgentRouter);
  app.use('/api/sre-agent', sreAgentRouter);

  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ message: error.message || 'Unexpected server error' });
  });

  return app;
};
