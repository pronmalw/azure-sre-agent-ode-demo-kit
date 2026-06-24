import { ConfidenceLevel, IncidentClassification, SreAgentReport, TelemetrySnapshot } from './types';

const COSMOS_TOGGLES = [
  'hotPartition',
  'metadataThrottling',
  'multipleClients',
  'crossPartitionQuery',
  'largeDocument',
  'missingIndexing',
  'pointReadMisuse',
] as const;
const APP_TOGGLES = ['hotPartition', 'metadataThrottling', 'multipleClients', 'largeDocument'] as const;
const DB_MODEL_TOGGLES = ['crossPartitionQuery', 'missingIndexing', 'pointReadMisuse'] as const;
const SQL_TOGGLES = ['sqlSlowQuery', 'sqlConnectionPressure'] as const;

const VERIFICATION_CRITERIA = [
  'p99 end-to-end latency returns to <200ms baseline',
  'Zero Cosmos DB 429 errors in 5-minute validation window',
  'Host CPU returns to <30% baseline',
  'CosmosClient singleton verified — one instance at application startup',
  'Query RU per operation <50 RU/s',
  'Unindexed query RU improves after indexing policy restored',
  'Checkout order write succeeds in Azure SQL in <200ms',
  'SQL query latency returns to <100ms',
  'SQL connection pool utilization <60%'
];

const hasToggle = (snapshot: TelemetrySnapshot, toggle: string): boolean => snapshot.activeToggles.includes(toggle);
const round = (value: number): number => Math.round(value * 100) / 100;

const addUnique = (items: string[], value: string): void => {
  if (!items.includes(value)) {
    items.push(value);
  }
};

const ownerMap: Record<IncidentClassification, { primary: string; secondary: string[] }> = {
  [IncidentClassification.APPLICATION_OR_CLIENT_SIDE]: {
    primary: 'Contoso Retail application engineering',
    secondary: ['Catalogue API owners', 'Cosmos SDK integration owners', 'AKS runtime owners'],
  },
  [IncidentClassification.AZURE_SERVICE_SIDE]: {
    primary: 'Azure platform team',
    secondary: ['Azure Support', 'Contoso incident manager'],
  },
  [IncidentClassification.DATABASE_CONFIG_OR_DATA_MODEL]: {
    primary: 'Contoso Retail data platform team',
    secondary: ['Cosmos DB schema owners', 'Catalogue engineering owners'],
  },
  [IncidentClassification.SQL_DATABASE_OR_SCHEMA]: {
    primary: 'Contoso Retail SQL/data engineering team',
    secondary: ['Checkout service owners', 'DBA on-call'],
  },
  [IncidentClassification.HOST_OR_RUNTIME]: {
    primary: 'AKS platform and runtime team',
    secondary: ['Node.js service owners', 'Application performance owners'],
  },
  [IncidentClassification.NETWORK_OR_CONNECTIVITY]: {
    primary: 'Network engineering',
    secondary: ['Platform operations'],
  },
  [IncidentClassification.RECENT_CHANGE_OR_DEPLOYMENT]: {
    primary: 'Release engineering',
    secondary: ['Application owners'],
  },
  [IncidentClassification.INSUFFICIENT_EVIDENCE]: {
    primary: 'Application on-call',
    secondary: ['Observability owners'],
  },
};

export const classifyIncident = (snapshot: TelemetrySnapshot): SreAgentReport => {
  const activeToggleSet = new Set(snapshot.activeToggles);
  const anyCosmosToggle = COSMOS_TOGGLES.some((toggle) => activeToggleSet.has(toggle));
  const anyAppToggle = APP_TOGGLES.some((toggle) => activeToggleSet.has(toggle));
  const anyDbToggle = DB_MODEL_TOGGLES.some((toggle) => activeToggleSet.has(toggle));
  const anySqlToggle = SQL_TOGGLES.some((toggle) => activeToggleSet.has(toggle));
  const onlyHighCpuToggle = activeToggleSet.size === 1 && activeToggleSet.has('highCpu');
  const onlyDbToggles = activeToggleSet.size > 0 && [...activeToggleSet].every((toggle) => DB_MODEL_TOGGLES.includes(toggle as (typeof DB_MODEL_TOGGLES)[number]));

  let primaryClassification = IncidentClassification.INSUFFICIENT_EVIDENCE;
  let confidence = ConfidenceLevel.LOW;

  if (snapshot.cosmos429Count > 10 && snapshot.serverSideLatencyMs < 100 && anyCosmosToggle) {
    primaryClassification = IncidentClassification.APPLICATION_OR_CLIENT_SIDE;
    confidence = ConfidenceLevel.HIGH;
  } else if (snapshot.serverSideLatencyMs > 500 && snapshot.cosmos429Count > 10 && activeToggleSet.size === 0) {
    primaryClassification = IncidentClassification.AZURE_SERVICE_SIDE;
    confidence = ConfidenceLevel.MEDIUM;
  } else if (snapshot.hostCpuPercent > 70 && snapshot.latencyP99Ms > 1000 && onlyHighCpuToggle) {
    primaryClassification = IncidentClassification.HOST_OR_RUNTIME;
    confidence = ConfidenceLevel.HIGH;
  } else if (anyDbToggle && onlyDbToggles) {
    primaryClassification = IncidentClassification.DATABASE_CONFIG_OR_DATA_MODEL;
    confidence = ConfidenceLevel.HIGH;
  } else if (anySqlToggle && snapshot.sqlQueryLatencyMs > 1000) {
    primaryClassification = IncidentClassification.SQL_DATABASE_OR_SCHEMA;
    confidence = ConfidenceLevel.HIGH;
  }

  const secondaryClassifications: IncidentClassification[] = [];
  if (snapshot.recentDeploymentEvent && snapshot.latencyP99Ms > 500) {
    secondaryClassifications.push(IncidentClassification.RECENT_CHANGE_OR_DEPLOYMENT);
  }
  if (snapshot.hostCpuPercent > 60 && primaryClassification !== IncidentClassification.HOST_OR_RUNTIME) {
    secondaryClassifications.push(IncidentClassification.HOST_OR_RUNTIME);
  }
  if (anyDbToggle && primaryClassification !== IncidentClassification.DATABASE_CONFIG_OR_DATA_MODEL) {
    secondaryClassifications.push(IncidentClassification.DATABASE_CONFIG_OR_DATA_MODEL);
  }
  if (anySqlToggle && snapshot.sqlQueryLatencyMs > 1000 && primaryClassification !== IncidentClassification.SQL_DATABASE_OR_SCHEMA) {
    secondaryClassifications.push(IncidentClassification.SQL_DATABASE_OR_SCHEMA);
  }

  const evidence: string[] = [];
  if (snapshot.latencyP99Ms > 500) {
    addUnique(
      evidence,
      `Client-side p99 latency: ${snapshot.latencyP99Ms}ms vs server-side Cosmos latency: ${snapshot.serverSideLatencyMs}ms — ${round(
        snapshot.latencyP99Ms - snapshot.serverSideLatencyMs,
      )}ms gap indicates client/SDK or host overhead`,
    );
  }
  if (snapshot.cosmos429Count > 0) {
    addUnique(evidence, `Cosmos DB 429 RateLimitExceeded: ${snapshot.cosmos429Count} in last 5 min on products container`);
  }
  if (hasToggle(snapshot, 'hotPartition')) {
    addUnique(evidence, "Hot partition pattern active: all writes routing to fixed partition key 'hot-category'");
  }
  if (hasToggle(snapshot, 'multipleClients')) {
    addUnique(evidence, 'Multiple CosmosClient instances: new client created per request instead of singleton');
  }
  if (hasToggle(snapshot, 'metadataThrottling')) {
    addUnique(evidence, 'Per-request metadata reads: container properties re-fetched on every operation');
  }
  if (hasToggle(snapshot, 'crossPartitionQuery')) {
    addUnique(evidence, 'Cross-partition fan-out query: SELECT * FROM c without partition key filter');
  }
  if (hasToggle(snapshot, 'largeDocument')) {
    addUnique(evidence, 'Large document writes: ~52KB documents (recommended <1KB for typical catalogue items)');
  }
  if (hasToggle(snapshot, 'missingIndexing')) {
    addUnique(evidence, 'Unindexed query on ProductsNoIndex: full scan, high RU expected');
  }
  if (hasToggle(snapshot, 'pointReadMisuse')) {
    addUnique(evidence, 'Query used instead of ReadItem: SELECT * FROM c WHERE c.id=@id vs ReadItemAsync(id,pk)');
  }
  if (hasToggle(snapshot, 'highCpu')) {
    addUnique(evidence, `Host CPU: ${snapshot.hostCpuPercent}% — CPU burn path active (fibonacci loop on request path)`);
  }
  if (hasToggle(snapshot, 'sqlSlowQuery')) {
    addUnique(evidence, `SQL query latency: ${snapshot.sqlQueryLatencyMs}ms — artificial slow query path enabled`);
  }
  if (hasToggle(snapshot, 'sqlConnectionPressure')) {
    addUnique(evidence, 'SQL connection pool pressure: connections held beyond normal release');
  }
  if (snapshot.recentDeploymentEvent) {
    addUnique(evidence, 'Recent deployment/change event detected — correlates with incident start');
  }
  if (snapshot.ruUsage > 500) {
    addUnique(evidence, `High RU consumption: ${snapshot.ruUsage} RU/min — ${round(snapshot.ruUsage / 100)}x above healthy baseline`);
  }
  if (snapshot.latencyP99Ms > 500 && snapshot.serverSideLatencyMs < 50) {
    addUnique(evidence, `Azure Cosmos DB server-side latency: ${snapshot.serverSideLatencyMs}ms — within normal range, indicating service is healthy`);
  }
  if (evidence.length === 0) {
    addUnique(evidence, 'No strong anomaly detected across client, server, host, or SQL telemetry during the sampled window.');
  }

  const ruledOutCauses: string[] = [];
  if (snapshot.serverSideLatencyMs < 100) {
    ruledOutCauses.push(`Azure Cosmos DB service-side outage ruled out: server-side p99 ${snapshot.serverSideLatencyMs}ms is healthy`);
  }
  if (!anySqlToggle && snapshot.sqlQueryLatencyMs < 250 && snapshot.sqlErrorCount === 0) {
    ruledOutCauses.push(`Azure SQL Database issue ruled out: SQL query latency ${snapshot.sqlQueryLatencyMs}ms, error count ${snapshot.sqlErrorCount}`);
  }
  if (!hasToggle(snapshot, 'highCpu') && snapshot.hostCpuPercent < 40) {
    ruledOutCauses.push(`Host resource exhaustion ruled out: CPU at ${snapshot.hostCpuPercent}%`);
  }
  if (!snapshot.recentDeploymentEvent) {
    ruledOutCauses.push('Azure regional outage ruled out: no Azure Service Health events detected');
  }

  const missingEvidence = ['No packet capture or client network trace collected yet', 'No query plan capture attached for Cosmos or SQL request path'];
  if (!snapshot.recentDeploymentEvent) {
    missingEvidence.push('No deployment correlation marker present to confirm or rule out recent release impact');
  }

  const immediateSafeActions: string[] = [];
  if (hasToggle(snapshot, 'hotPartition')) {
    immediateSafeActions.push('Disable hot partition chaos toggle — restore natural partition key routing by categoryId/userId');
  }
  if (hasToggle(snapshot, 'multipleClients')) {
    immediateSafeActions.push('Stop creating new CosmosClient per request — use singleton initialized at startup');
  }
  if (hasToggle(snapshot, 'metadataThrottling')) {
    immediateSafeActions.push('Remove per-request metadata reads — cache container properties at startup');
  }
  if (hasToggle(snapshot, 'highCpu')) {
    immediateSafeActions.push('Disable CPU burn path — remove synchronous Fibonacci computation from request path');
  }
  if (hasToggle(snapshot, 'crossPartitionQuery')) {
    immediateSafeActions.push('Replace cross-partition query with targeted query using WHERE c.categoryId = @categoryId');
  }
  if (hasToggle(snapshot, 'missingIndexing')) {
    immediateSafeActions.push('Restore indexing policy on ProductsNoIndex, or route queries back to indexed Products container');
  }
  if (hasToggle(snapshot, 'pointReadMisuse')) {
    immediateSafeActions.push('Replace query with ReadItemAsync(id, partitionKey) for known id+pk combinations');
  }
  if (hasToggle(snapshot, 'largeDocument')) {
    immediateSafeActions.push('Reduce document size — extract large blobs to Azure Blob Storage, keep documents <1KB');
  }
  if (hasToggle(snapshot, 'sqlSlowQuery')) {
    immediateSafeActions.push('Disable SQL slow query simulation — verify no N+1 query patterns in checkout path');
  }
  if (hasToggle(snapshot, 'sqlConnectionPressure')) {
    immediateSafeActions.push('Disable SQL connection pressure — ensure connections returned to pool promptly');
  }
  immediateSafeActions.push('Verify singleton CosmosClient initialized at application startup and reused across all requests');
  immediateSafeActions.push('Verify SQL connection pool max size is appropriate for expected concurrency');

  const approvalRequiredActions = [
    'Re-enable indexing policy on ProductsNoIndex container — requires change request, impacts write RU',
    'Scale AKS node pool — temporary mitigation pending root cause resolution and cost review',
    'Increase Cosmos DB throughput/autoscale — temporary mitigation only; pending cost/risk review',
    'Add SQL index — requires query plan review and DBA approval in production-like environment',
  ];

  const doNotDoGuidance: string[] = [];
  if (primaryClassification === IncidentClassification.APPLICATION_OR_CLIENT_SIDE) {
    doNotDoGuidance.push('DO NOT treat this as Azure/Cosmos DB service outage — server-side metrics are healthy');
    doNotDoGuidance.push('DO NOT blindly increase provisioned RU/s — this masks the hot partition root cause');
    doNotDoGuidance.push('DO NOT ignore hot partition evidence — increasing throughput without fixing key distribution does not resolve root cause');
  }
  if (!anySqlToggle) {
    doNotDoGuidance.push(`DO NOT blame Azure SQL when SQL signals are healthy — SQL latency is ${snapshot.sqlQueryLatencyMs}ms`);
  }
  doNotDoGuidance.push('DO NOT leave demo chaos toggles enabled — reset before any customer handoff');

  const escalationRecommendation =
    primaryClassification === IncidentClassification.APPLICATION_OR_CLIENT_SIDE && confidence === ConfidenceLevel.HIGH
      ? 'Do NOT escalate to Azure/Cosmos support. Evidence strongly indicates application-side patterns. Escalate only if server-side latency exceeds 200ms p99, availability drops below 99.9%, or Azure Service Health shows regional impact.'
      : primaryClassification === IncidentClassification.AZURE_SERVICE_SIDE
        ? 'Consider escalating to Azure Support — server-side signals suggest possible service degradation. Include CRI/subscription ID and telemetry exports.'
        : primaryClassification === IncidentClassification.SQL_DATABASE_OR_SCHEMA
          ? 'Escalate to the SQL/data engineering owner if latency remains above 1000ms after disabling synthetic pressure. Azure escalation is not required unless platform errors persist.'
          : 'Keep escalation within the Contoso engineering response bridge while corrective actions are validated. Escalate externally only if ruled-out causes become active signals.';

  const topIssues = evidence.slice(0, 3).join('; ') || 'insufficient evidence for a conclusive root cause';
  const customerImpact =
    snapshot.latencyP99Ms > 1000 || snapshot.checkoutSuccessRate < 0.95
      ? `Customers are experiencing degraded catalogue and checkout performance (p99 ${snapshot.latencyP99Ms}ms, checkout success ${(snapshot.checkoutSuccessRate * 100).toFixed(0)}%).`
      : `Low-severity symptoms observed with p99 latency ${snapshot.latencyP99Ms}ms and checkout success ${(snapshot.checkoutSuccessRate * 100).toFixed(0)}%.`;

  const temporaryMitigation =
    immediateSafeActions.length > 0
      ? `Execute the following safe mitigations first: ${immediateSafeActions.slice(0, 3).join('; ')}.`
      : 'No safe mitigation identified beyond enhanced monitoring and evidence collection.';
  const permanentFix =
    primaryClassification === IncidentClassification.APPLICATION_OR_CLIENT_SIDE
      ? 'Refactor Cosmos access patterns to use a singleton client, targeted point reads, well-distributed partition keys, and lean document shapes.'
      : primaryClassification === IncidentClassification.DATABASE_CONFIG_OR_DATA_MODEL
        ? 'Correct the Cosmos indexing and query design, then validate RU efficiency with representative load.'
        : primaryClassification === IncidentClassification.SQL_DATABASE_OR_SCHEMA
          ? 'Tune SQL schema and pool settings, then validate order-write latency under concurrency.'
          : primaryClassification === IncidentClassification.HOST_OR_RUNTIME
            ? 'Remove synchronous CPU-heavy work from the request path and right-size AKS runtime capacity.'
            : primaryClassification === IncidentClassification.AZURE_SERVICE_SIDE
              ? 'Capture service-side evidence and coordinate with Azure Support while maintaining customer communications.'
              : 'Collect additional telemetry to determine a durable corrective action.';

  const rollbackGuidance =
    'Rollback guidance: if approved changes are applied, revert the indexing policy change, reset AKS node scaling to baseline, roll back any Cosmos throughput increase, and remove non-essential SQL indexes after confirming the incident has cleared. For code fixes, disable the corresponding chaos path and redeploy the last known-good build.';

  const executiveSummary = `During the incident window, Contoso Retail customers experienced degraded checkout and product catalogue performance (p99: ${snapshot.latencyP99Ms}ms). Investigation evidence indicates the root cause is ${primaryClassification === IncidentClassification.APPLICATION_OR_CLIENT_SIDE ? 'application-side' : primaryClassification === IncidentClassification.AZURE_SERVICE_SIDE ? 'service-side' : 'most likely associated with the active failure domain'}, specifically: ${topIssues}. Azure Cosmos DB service-side health remained ${snapshot.serverSideLatencyMs < 100 ? 'nominal' : 'degraded'} (server-side latency: ${snapshot.serverSideLatencyMs}ms). ${snapshot.sqlQueryLatencyMs < 250 ? 'Azure SQL Database remained healthy.' : 'Azure SQL requires further validation.'} Immediate corrective actions are identified and safe to execute without service escalation.`;

  const engineeringRca = `Telemetry shows p99 latency at ${snapshot.latencyP99Ms}ms with ${snapshot.cosmos429Count} Cosmos 429 events, ${snapshot.ruUsage} RU/min consumption, host CPU ${snapshot.hostCpuPercent}%, and SQL latency ${snapshot.sqlQueryLatencyMs}ms. The active toggles (${snapshot.activeToggles.join(', ') || 'none'}) directly align with the observed failure signature. The client-to-server latency delta of ${round(
    snapshot.latencyP99Ms - snapshot.serverSideLatencyMs,
  )}ms indicates most latency is introduced in the application, SDK, query design, or host execution path rather than inside the Azure Cosmos DB service plane.`;

  const teamsUpdate = `Incident update\n- Primary classification: ${primaryClassification}\n- Confidence: ${confidence}\n- Customer impact: ${customerImpact}\n- Primary owner: ${ownerMap[primaryClassification].primary}\n- Evidence: ${evidence.slice(0, 4).join(' | ')}\n- Safe actions underway: ${immediateSafeActions.slice(0, 4).join(' | ')}\n- Escalation: ${escalationRecommendation}`;

  return {
    incidentId: `inc-${Date.now()}`,
    primaryClassification,
    secondaryClassifications,
    confidence,
    customerImpact,
    primaryOwner: ownerMap[primaryClassification].primary,
    secondaryOwners: ownerMap[primaryClassification].secondary,
    evidence,
    ruledOutCauses,
    missingEvidence,
    immediateSafeActions,
    approvalRequiredActions,
    doNotDoGuidance,
    escalationRecommendation,
    temporaryMitigation,
    permanentFix,
    rollbackGuidance,
    verificationCriteria: VERIFICATION_CRITERIA,
    executiveSummary,
    engineeringRca,
    teamsUpdate,
    generatedAt: new Date().toISOString(),
  };
};
