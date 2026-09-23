# SRE Agent demo prompt (validated)

> Paste into [sre.azure.com](https://sre.azure.com) → `contoso-sre-agent`.
>
> Every table and metric name below was verified against the live workspace
> `law-euqicty6gdfys` on 2026-09-23. See "Verified data sources" at the bottom
> for what exists and what does not.

## Demo flow

1. Open `http://48.207.241.23/ops` and flip one chaos toggle.
2. Let it run **60 seconds** so the telemetry window fills.
3. Paste the prompt below into the agent.
4. Reset from `/ops` when finished.

> The API publishes a telemetry snapshot every ~2s, so a 15-minute lookback is
> enough. Use a longer window only if the toggle has been on for a while.

---

## Master prompt

```
ROLE: You are the Azure SRE Agent for the Contoso Retail e-commerce platform.
An alert has fired. Investigate, determine the root cause, and tell me whether
this warrants an Azure support case. Do not remediate until I approve.

ENVIRONMENT
  Resource group : rg-sreagent-ode-demo (West Europe)
  AKS cluster    : aks-contoso-sreagent-demo, namespace contoso-retail
  Workloads      : contoso-retail-api (1 replica), contoso-retail-web
  Log Analytics  : law-euqicty6gdfys (workspace 527754b0-cdd5-467a-9128-4f3a4a173b16)
  App Insights   : appi-euqicty6gdfys (workspace-based)
  Cosmos DB      : cosmos-euqicty6gdfys           (serverless, primary store)
                   cosmos-throttle-euqicty6gdfys  (provisioned 400 RU/s, container
                                                   HotPartition, partition key /pk)
  Azure SQL      : sql-euqicty6gdfys / contoso-retail-db
  Window         : last 15 minutes

IMPORTANT SCHEMA NOTES — use these exact names, others do not exist here:
  - Application telemetry is workspace-based: use AppMetrics, AppRequests,
    AppDependencies, AppEvents. The classic names (requests, traces,
    customMetrics, customEvents) are NOT available.
  - Container CPU is in Perf under ObjectName "K8SContainer",
    CounterName "cpuUsageNanoCores". It is NOT in InsightsMetrics.
  - There is no availability test, so AppAvailabilityResults is empty.

PHASE 1 — COLLECT EVIDENCE
Run these queries. Report the actual numbers you get.

1. Golden signals published by the application:
   AppMetrics
   | where TimeGenerated > ago(15m)
   | where Name startswith "contoso."
   | summarize avg = avg(Sum / ItemCount), max = max(Max) by Name
   | order by Name asc

   The metrics that exist are exactly:
     contoso.latencyP50Ms            contoso.latencyP99Ms
     contoso.ruUsage                 contoso.cosmos429Count
     contoso.sqlQueryLatencyMs       contoso.sqlErrorCount
     contoso.hostCpuPercent          contoso.checkoutSuccessRate
     contoso.vpnTunnelDown           contoso.networkPacketLossPercent
     contoso.activeToggleCount

2. Cosmos DB throttling, measured at the dependency layer:
   AppDependencies
   | where TimeGenerated > ago(15m)
   | where Target has "documents.azure.com"
   | summarize total = count(),
               throttled = countif(ResultCode == "429"),
               p99 = percentile(DurationMs, 99)
             by Target, bin(TimeGenerated, 1m)
   | order by TimeGenerated desc

3. Per-partition RU consumption (server-side truth, not app-reported):
   AzureDiagnostics
   | where TimeGenerated > ago(15m)
   | where Category == "PartitionKeyRUConsumption"
   | summarize ru = sum(todouble(requestCharge_s)) by partitionKey_s
   | order by ru desc

4. Container CPU:
   Perf
   | where TimeGenerated > ago(15m)
   | where ObjectName == "K8SContainer" and CounterName == "cpuUsageNanoCores"
   | summarize avgCores = avg(CounterValue) / 1000000000.0
             by bin(TimeGenerated, 1m), InstanceName
   | order by TimeGenerated desc

5. Pod restarts and health:
   KubePodInventory
   | where TimeGenerated > ago(15m)
   | summarize restarts = sum(ContainerRestartCount) by Name, PodStatus
   | order by restarts desc

6. Azure SQL server-side query statistics:
   AzureDiagnostics
   | where TimeGenerated > ago(15m)
   | where ResourceProvider == "MICROSOFT.SQL"
   | summarize cnt = count() by Category
   | order by cnt desc

PHASE 2 — CLASSIFY
Assign exactly one classification and justify it with the numbers you measured:

  APPLICATION_OR_CLIENT_SIDE     Application code or client SDK misuse. Azure is healthy.
  DATABASE_CONFIG_OR_DATA_MODEL  Partition key, indexing or query design problem.
  HOST_OR_RUNTIME                AKS pod or node resource exhaustion.
  AZURE_SERVICE_INCIDENT         Genuine Azure-side degradation.
  INSUFFICIENT_EVIDENCE          No anomaly detected.

Reference thresholds used by this platform:
  healthy p99 < 200ms  |  host CPU > 70% is saturated
  any sustained 429 count > 0 is throttling
  SQL p95 > 1000ms is a slow-query condition

PHASE 3 — REPORT
Produce:
  - EXECUTIVE SUMMARY (3 sentences, for a VP)
  - EVIDENCE table: metric, observed value, healthy baseline, verdict
  - ROOT CAUSE in one plain-English sentence
  - RAISE AZURE SUPPORT CASE: YES or NO, and why
  - DO NOT DO: the tempting-but-wrong action (e.g. "do not increase RU",
    "do not scale the node pool") and the reason it would not help
  - RECOMMENDED FIX, and who owns it (app team vs platform vs Microsoft)

PHASE 4 — APPROVAL GATE
List the remediation actions you could take, each with risk level and whether it
is reversible. Then STOP and wait for my explicit approval before executing
anything.
```

---

## Short prompts for individual scenarios

| Toggle | Prompt |
|---|---|
| `hotPartition` | `Cosmos DB is returning 429s for Contoso Retail in rg-sreagent-ode-demo. My team wants to double the provisioned RU. Check per-partition RU consumption in AzureDiagnostics (Category PartitionKeyRUConsumption) before I approve that spend. Is this a capacity problem or a partition key design problem?` |
| `highCpu` | `The Contoso Retail API is slow. Check container CPU in Perf (ObjectName K8SContainer, CounterName cpuUsageNanoCores) and correlate with contoso.latencyP99Ms in AppMetrics over the last 15 minutes. Should we scale the AKS node pool, or is this something else?` |
| `sqlSlowQuery` | `Checkout is taking several seconds for Contoso Retail. Cosmos looks fine. Investigate contoso.sqlQueryLatencyMs and contoso.sqlErrorCount in AppMetrics, plus MICROSOFT.SQL rows in AzureDiagnostics. Is this an Azure SQL service issue or a query design problem?` |
| `vpnConnectivityIssue` | `Check contoso.vpnTunnelDown and contoso.networkPacketLossPercent in AppMetrics for the last 15 minutes, and the VPN connection state in rg-sreagent-ode-demo. Is the tunnel actually down, and is it our configuration or an Azure network incident?` |
| none (false alarm) | `A customer reports Contoso Retail is slow. Before I wake the on-call engineer, check the contoso.* metrics in AppMetrics and Cosmos dependency failures in AppDependencies for the last 15 minutes. Is there an actual incident here?` |

---

## Verified data sources

Confirmed present in `law-euqicty6gdfys` (24h counts, 2026-09-23):

| Table | Rows | Use |
|---|---|---|
| `Perf` | 518,440 | container CPU / memory |
| `AppDependencies` | 138,223 | Cosmos calls, 429 result codes |
| `AzureDiagnostics` | 80,943 | Cosmos partition RU, SQL query stats |
| `KubePodInventory` | 69,135 | pod status, restarts |
| `AppMetrics` | 32,049 | the 11 `contoso.*` golden signals |
| `AppRequests` | 13,489 | HTTP request latency |
| `AppEvents` | 2,905 | `ContosoTelemetrySnapshot` |

Confirmed **absent** — do not reference these:

- `requests`, `traces`, `customMetrics`, `customEvents` — classic App Insights
  schema, not available in a workspace-based resource.
- `InsightsMetrics` contains no `cpuUsageNanoCores`; only
  `process_cpu_seconds_total` from a Prometheus scrape.
- `AppAvailabilityResults` — no availability test is configured.
- Metric names `cosmos_ru_consumed`, `sql_query_duration_ms`, `cosmos_429`,
  `cosmos_query`, `cosmos_write` do not exist. Use the `contoso.*` names.
