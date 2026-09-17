// Must be the first import: boots Application Insights before anything else loads.
import './bootstrap';
import { startMetricPublisher } from './observability';
import { createApp } from './app';
import { appConfig } from './config';
import { getTelemetryService } from './services/telemetry.service';

const app = createApp();

startMetricPublisher(() => getTelemetryService().getSnapshot() as unknown as Record<string, unknown>);

app.listen(appConfig.port, () => {
  console.log(`Contoso Retail API listening on port ${appConfig.port}`);
});
