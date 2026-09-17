// Side-effect module: importing this first guarantees Application Insights is
// initialised before Express, mssql or the Cosmos SDK are evaluated, because ES
// module imports are evaluated depth-first in source order.
import { startObservability } from './observability';

startObservability();
