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

## Full triage prompt — all faults, AKS deep dive, PDF report

Use this one when every toggle is on and you want a complete report. It pins an
absolute time window (the agent otherwise drifts and reports diluted averages)
and forces the AKS evidence to the surface.

Replace `<START>` and `<END>` with UTC timestamps covering the incident, e.g.
`2026-09-24 10:30:00` and `2026-09-24 10:45:00`.

```
ROLE: You are the Azure SRE Agent for the Contoso Retail e-commerce platform.
Multiple alerts have fired. Triage EVERY active fault, not just the first one.
Produce a formal incident report I can export to PDF, with a concrete solution
per finding. Execute no remediation until I explicitly approve.

ENVIRONMENT
  Resource group : rg-sreagent-ode-demo (West Europe)
  AKS cluster    : aks-contoso-sreagent-demo, namespace contoso-retail
  Workloads      : contoso-retail-api (1 replica, cpu request 250m / limit 1 core,
                   memory request 256Mi / limit 512Mi)
                   contoso-retail-web (2 replicas, HPA 2-10 at 70% CPU)
  Log Analytics  : law-euqicty6gdfys (workspace 527754b0-cdd5-467a-9128-4f3a4a173b16)
  App Insights   : appi-euqicty6gdfys (workspace-based)
  Cosmos DB      : cosmos-euqicty6gdfys           (serverless, primary store)
                   cosmos-throttle-euqicty6gdfys  (provisioned 400 RU/s, container
                                                   HotPartition, partition key /pk)
  Azure SQL      : sql-euqicty6gdfys / contoso-retail-db
  VPN            : site-to-site gateway in the same resource group

TIME WINDOW — BINDING
  Use exactly: between (datetime(<START>) .. datetime(<END>))
  Apply this identical window to EVERY query. Do not substitute ago(). State the
  window in the report header and confirm each query used it. If a metric is
  constant across the window, say so rather than averaging it against data
  outside the window.

SCHEMA RULES — use these exact names. Others silently return zero rows:
  - Telemetry is workspace-based: AppMetrics, AppRequests, AppDependencies,
    AppEvents. Classic App Insights names (requests, traces, customMetrics,
    customEvents) are NOT available.
  - Container and node CPU are in Perf, ObjectName "K8SContainer" / "K8SNode",
    CounterName "cpuUsageNanoCores". NOT in InsightsMetrics.
  - No availability test exists; AppAvailabilityResults is empty.

ANALYSIS RULE — SEVERITY FROM MAXIMA
  Averages understate severity. For every metric report BOTH avg() and max(),
  and judge severity on max() and the most recent bins.

EVIDENCE QUALITY RULE — MANDATORY
  contoso.activeToggleCount and the AppEvents "ContosoTelemetrySnapshot"
  activeToggles dimension are the application DECLARING its own fault state.
  That is a self-report, not independent evidence. For each finding label the
  evidence as either:
    [MEASURED]  - independent infrastructure/service telemetry
                  (429 result codes, Perf CPU, KubeEvents, VPN control plane,
                   AzureDiagnostics)
    [SELF-REPORTED] - only the application's own toggle state supports it
  Rank findings so [MEASURED] ones lead. Never present a [SELF-REPORTED]
  finding as though it were independently proven.

PHASE 1 — APPLICATION AND DATA TIER

1. Golden signals:
   AppMetrics
   | where TimeGenerated between (datetime(<START>) .. datetime(<END>))
   | where Name startswith "contoso."
   | summarize avg = round(avg(Sum / ItemCount), 2), max = max(Max) by Name
   | order by Name asc

   Metrics that exist: contoso.latencyP50Ms, contoso.latencyP99Ms,
   contoso.ruUsage, contoso.cosmos429Count, contoso.sqlQueryLatencyMs,
   contoso.sqlErrorCount, contoso.hostCpuPercent, contoso.checkoutSuccessRate,
   contoso.vpnTunnelDown, contoso.networkPacketLossPercent,
   contoso.activeToggleCount

2. Cosmos throttling (server truth):
   AppDependencies
   | where TimeGenerated between (datetime(<START>) .. datetime(<END>))
   | where Target has "documents.azure.com"
   | summarize total = count(), throttled = countif(ResultCode == "429"),
               p99 = round(percentile(DurationMs, 99), 2), maxDur = max(DurationMs)
             by Target
   | extend throttlePct = round(100.0 * throttled / total, 2)

3. Per-partition RU skew:
   AzureDiagnostics
   | where TimeGenerated between (datetime(<START>) .. datetime(<END>))
   | where Category == "PartitionKeyRUConsumption"
   | summarize ru = round(sum(todouble(requestCharge_s)), 2) by partitionKey_s
   | order by ru desc

4. Azure SQL server-side wait statistics — DO NOT SKIP.
   SQL diagnostics ARE configured in this workspace. If you get zero rows,
   widen to ago(24h) and report what you find; do NOT conclude that the
   diagnostic stream is missing.
   AzureDiagnostics
   | where TimeGenerated between (datetime(<START>) .. datetime(<END>))
   | where ResourceProvider == "MICROSOFT.SQL"
   | project TimeGenerated, Category, Resource, wait_type_s, wait_time_ms_d,
             delta_max_time_d, query_hash_s
   | order by TimeGenerated desc

   Then summarise the dominant wait type:
   AzureDiagnostics
   | where TimeGenerated between (datetime(<START>) .. datetime(<END>))
   | where Category == "DatabaseWaitStatistics"
   | summarize totalWaitMs = sum(todouble(delta_wait_time_ms_d)) by wait_type_s
   | order by totalWaitMs desc

   Use the dominant wait type to explain WHY the query is slow (CPU, IO, lock,
   or memory grant). Do not rely on application-reported timing alone.

PHASE 2 — AKS DEEP DIVE (MANDATORY SECTION, REPORT SEPARATELY)

Kubernetes is a first-class subject of this investigation, not background. Even
if the application tier explains the latency, you MUST report cluster health,
resource sizing correctness, and scheduling/elasticity posture.

5. Container CPU against its configured limit AND request:
   let lim = Perf
     | where TimeGenerated between (datetime(<START>) .. datetime(<END>))
     | where ObjectName == "K8SContainer" and CounterName == "cpuLimitNanoCores"
     | summarize lim = max(CounterValue) by InstanceName;
   let req = Perf
     | where TimeGenerated between (datetime(<START>) .. datetime(<END>))
     | where ObjectName == "K8SContainer" and CounterName == "cpuRequestNanoCores"
     | summarize req = max(CounterValue) by InstanceName;
   Perf
   | where TimeGenerated between (datetime(<START>) .. datetime(<END>))
   | where ObjectName == "K8SContainer" and CounterName == "cpuUsageNanoCores"
   | summarize used = avg(CounterValue), peak = max(CounterValue) by InstanceName
   | join kind=inner lim on InstanceName
   | join kind=inner req on InstanceName
   | extend pctOfLimit = round(100.0 * peak / lim, 1),
            pctOfRequest = round(100.0 * used / req, 1)
   | project container = tostring(split(InstanceName, "/")[-1]),
             peakCores = round(peak / 1e9, 3), limitCores = round(lim / 1e9, 2),
             requestCores = round(req / 1e9, 3), pctOfLimit, pctOfRequest
   | order by pctOfLimit desc

   Interpret explicitly:
     - pctOfLimit near 100 means the container is being CPU-throttled by its
       cgroup. This is a HARD ceiling: adding nodes will NOT help.
     - pctOfRequest far above 100 means the CPU request understates real usage,
       so the scheduler is placing the pod on inadequate capacity and it has no
       guaranteed share under contention.

6. Container memory against its limit:
   Perf
   | where TimeGenerated between (datetime(<START>) .. datetime(<END>))
   | where ObjectName == "K8SContainer" and CounterName == "memoryWorkingSetBytes"
   | summarize avgMiB = round(avg(CounterValue)/1048576.0, 1),
               maxMiB = round(max(CounterValue)/1048576.0, 1) by InstanceName
   | order by maxMiB desc

7. Kubernetes warning events — probe failures, scheduling, autoscaling:
   KubeEvents
   | where TimeGenerated > ago(24h)
   | where KubeEventType == "Warning"
   | project TimeGenerated, Name, Reason, Message
   | order by TimeGenerated desc

   Call out specifically:
     - Unhealthy / probe failures: proof that CPU starvation reached the point
       where kubelet could not get a timely health response. Explain that a
       readiness failure removes the pod from Service endpoints, so this is
       customer-visible, not cosmetic.
     - FailedGetResourceMetric / FailedComputeMetricsReplicas: the HPA could not
       read metrics and therefore could not scale. State whether this is current
       or historical based on the event timestamps.

8. Pod inventory and restarts:
   KubePodInventory
   | where TimeGenerated between (datetime(<START>) .. datetime(<END>))
   | summarize restarts = sum(ContainerRestartCount), samples = count()
             by Name, PodStatus, Namespace
   | order by restarts desc

9. Node saturation and headroom:
   let cap = Perf
     | where TimeGenerated between (datetime(<START>) .. datetime(<END>))
     | where ObjectName == "K8SNode" and CounterName == "cpuCapacityNanoCores"
     | summarize cap = max(CounterValue) by Computer;
   Perf
   | where TimeGenerated between (datetime(<START>) .. datetime(<END>))
   | where ObjectName == "K8SNode" and CounterName == "cpuUsageNanoCores"
   | summarize peak = max(CounterValue), avgUse = avg(CounterValue) by Computer
   | join kind=inner cap on Computer
   | extend nodeCpuPctPeak = round(100.0 * peak / cap, 1),
            nodeCpuPctAvg  = round(100.0 * avgUse / cap, 1)
   | project Computer, nodeCpuPctAvg, nodeCpuPctPeak

10. Node readiness:
    KubeNodeInventory
    | where TimeGenerated between (datetime(<START>) .. datetime(<END>))
    | summarize samples = count() by Computer, Status

11. Also inspect the live cluster and report:
    - Does contoso-retail-api have an HPA? How many replicas, and what is the
      configured minimum?
    - Is a single replica a single point of failure for this workload?
    - Are the readiness and liveness probe timeouts appropriate for a service
      that can saturate its CPU?

PHASE 3 — CLASSIFY EVERY FAULT
Multiple independent root causes are active. Do not stop at the first. For each,
give one classification plus the [MEASURED] / [SELF-REPORTED] label:

  APPLICATION_OR_CLIENT_SIDE     App code or SDK misuse. Azure is healthy.
  DATABASE_CONFIG_OR_DATA_MODEL  Partition key, indexing or query design.
  HOST_OR_RUNTIME                AKS pod/node resource exhaustion or misconfig.
  AZURE_SERVICE_INCIDENT         Genuine Azure-side degradation.
  INSUFFICIENT_EVIDENCE          No anomaly detected.

Thresholds: healthy p99 < 200ms | container > 70% of CPU limit = saturated
| pctOfRequest > 150 = under-requested | any sustained 429 > 0 = throttling
| SQL p95 > 1000ms = slow query | packet loss > 0% = tunnel fault
| any Unhealthy probe event = customer-visible availability risk

PHASE 4 — INCIDENT REPORT (structure for PDF export)

  CONTOSO RETAIL — SRE INCIDENT REPORT
  Generated: <timestamp>   Window: <START> to <END> UTC   Agent: contoso-sre-agent

  1. EXECUTIVE SUMMARY
     5 sentences for a VP: what is broken, customer impact, who owns each fix,
     what we are deliberately NOT doing, expected time to resolution.

  2. FINDINGS TABLE
     | # | Fault | Evidence (max) | Evidence quality | Baseline | Severity | Classification | Owner |

  3. AKS CLUSTER HEALTH — dedicated section, do not fold into other findings
     | Container | Peak cores | Limit | % of limit | Request | % of request | Verdict |
     Plus: node CPU peak per node, node Ready status, pod restart counts,
     every Kubernetes Warning event with its interpretation, HPA coverage and
     replica posture. State plainly whether the cluster is the CAUSE of the
     incident or a VICTIM of application behaviour, and give the evidence for
     that judgement. Include right-sizing recommendations for CPU/memory
     requests and limits based on the measured numbers.

  4. DETAILED FINDINGS — one section per fault:
     - Evidence (with [MEASURED] / [SELF-REPORTED] label) and timestamps
     - Root cause in one plain-English sentence
     - Customer impact / blast radius
     - DO NOT DO: the tempting-but-wrong action and why it wastes money
     - SOLUTION: specific fix, config change or code pattern
     - Effort and owner (app team / platform team / Microsoft)

  5. SUPPORT CASE RECOMMENDATION
     RAISE AZURE SUPPORT CASE: YES or NO per fault, justified.

  6. CORRELATION ANALYSIS
     Which faults are independent vs consequential? Explicitly answer: is the
     AKS CPU ceiling a cause of latency, or a symptom of the application's own
     workload? Name the single highest-leverage fix.

  7. ENGINEERING RCA
     One technical paragraph for a post-mortem.

PHASE 5 — APPROVAL GATE (MANDATORY)
List each remediation action with resource affected, risk, and reversibility.
Include AKS-specific actions (right-size requests/limits, add an HPA for the API,
raise probe timeouts, scale replicas) as distinct items. Then STOP and ask me to
reply APPROVE ALL / APPROVE <numbers> / REJECT. Execute nothing before I answer.
```

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
