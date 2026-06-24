import { createApp } from './app';
import { appConfig } from './config';

const app = createApp();

app.listen(appConfig.port, () => {
  console.log(`Contoso Retail API listening on port ${appConfig.port}`);
});
