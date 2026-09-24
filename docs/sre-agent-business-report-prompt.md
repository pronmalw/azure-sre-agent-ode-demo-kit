# SRE Agent prompt — non-technical PDF report

Use this when you need a report a business audience can follow. It was
validated against the live workspace: every table and metric name below
exists and returns rows during an active incident.

Copy everything between the lines into the Azure SRE Agent.

---

You are investigating a live production incident in the **Contoso Retail** application running on Azure. Produce a **single PDF report written for a non-technical business audience**. Assume the reader does not know what Kubernetes, Cosmos DB or a request unit is. Explain any term the first time you use it, in one short sentence.

## Time window

Use the absolute window **2026-09-24 13:35 UTC to now**. Apply this same window to every query. Do not use relative windows such as "last hour", and do not widen the window — doing so mixes in healthy data and understates how bad the incident is.

## Where to look

- Subscription `d095c6c9-21e9-4fec-bfb0-429d1409e8e0`
- Resource groups `rg-sreagent-ode-demo` and `mc_rg-sreagent-ode-demo_aks-contoso-sreagent-demo_westeurope`
- Log Analytics workspace `law-euqicty6gdfys`
- Application Insights `appi-euqicty6gdfys`

## Telemetry schema — read this before writing any query

Application Insights here is **workspace-based**. The classic tables do **not** exist and will silently return nothing. Do not use `requests`, `traces`, `customMetrics`, `customEvents`, or `InsightsMetrics` for CPU.

Use only these:

| Need | Use |
|---|---|
| HTTP request latency and failures | `AppRequests` |
| Calls out to Cosmos DB, including throttling | `AppDependencies` |
| Application metrics | `AppMetrics` |
| Application events | `AppEvents` |
| Container and node CPU / memory | `Perf` where `ObjectName == "K8SContainer"` or `"K8SNode"`, `CounterName == "cpuUsageNanoCores"` or `"memoryWorkingSetBytes"` |
| Kubernetes warnings, probe failures | `KubeEvents` |
| Pod status and restarts | `KubePodInventory` |
| Azure resource diagnostics (Cosmos partitions, SQL waits) | `AzureDiagnostics` |

The only application metrics that exist are named `contoso.*`:
`latencyP50Ms`, `latencyP99Ms`, `ruUsage`, `cosmos429Count`, `sqlQueryLatencyMs`, `sqlErrorCount`, `hostCpuPercent`, `checkoutSuccessRate`, `vpnTunnelDown`, `networkPacketLossPercent`, `activeToggleCount`.

Cosmos DB throttling is counted as `AppDependencies | where ResultCode == "429"`.

Container CPU is reported in nanocores — divide by 1,000,000,000 to get cores. The API container has a limit of **1 core** and a request of **0.25 cores**.

**If a query returns no rows, say so explicitly. Never estimate, never illustrate, never carry a number over from another window.**

## Evidence rule

Tag every factual claim:

- **[MEASURED]** — you got this from a query result. Quote the number.
- **[SELF-REPORTED]** — this comes from the application describing its own condition, via `contoso.activeToggleCount` or the `ContosoTelemetrySnapshot` event in `AppEvents`.

When describing how bad something is, use `max()`, not `avg()`. Averages across the window hide the peaks and will understate severity.

## Report structure — use exactly these sections, in this order

### Section 1 — How the system is put together

Describe the path a customer request actually takes, in plain English, as a numbered flow. Verify it against the resource graph before writing it. It is:

1. The customer's **browser**
2. An **Azure load balancer** with a public address
3. The **web tier** — serves the pages, and passes anything under `/api/` onwards
4. The **API tier** — does the real work: search, basket, checkout
5. The API then talks to **Cosmos DB** (product catalogue, baskets, reviews) and **Azure SQL** (prices, customers, orders)

Both the web and API tiers run as containers on a Kubernetes cluster (AKS).

State clearly that there is also a **VPN gateway** representing a link to a corporate network, and that **it is not in the customer request path** — no customer traffic flows through it. Do not imply the VPN causes page slowness.

Include a simple diagram or numbered flow a non-technical reader can follow.

### Section 2 — What a customer would have noticed

Translate the telemetry into customer experience. How much slower were pages? Did checkout still work? Quote `contoso.latencyP99Ms` (max), `contoso.latencyP50Ms` (max) and `contoso.checkoutSuccessRate` (min). Explain that "p99 latency" means the slowest 1% of visits.

### Section 3 — What is actually wrong

List each distinct problem you can evidence. For every one give:

- A one-line plain-English description
- The evidence, with the number and the table it came from, tagged [MEASURED] or [SELF-REPORTED]
- How severe it is, and why

You must investigate all of the following and report what you find:

- **Application speed** — `AppRequests` and `contoso.latencyP99Ms`
- **Database throttling** — `AppDependencies` where `ResultCode == "429"`; report both the count and the percentage of total calls
- **Database cost per operation** — `contoso.ruUsage`
- **Slow relational queries** — `contoso.sqlQueryLatencyMs` and `contoso.sqlErrorCount`, plus anything in `AzureDiagnostics` for SQL
- **The Kubernetes cluster — this section is mandatory.** Report:
  - Peak API container CPU as a fraction of its 1-core limit, from `Perf`
  - Average container CPU against its 0.25-core request
  - Node-level CPU from `Perf` where `ObjectName == "K8SNode"`, and how many nodes are busy
  - Anything in `KubeEvents`, especially health-probe failures
  - Any pod restarts in `KubePodInventory`
- **The network link** — `contoso.vpnTunnelDown` and `contoso.networkPacketLossPercent`, plus the VPN connection state from the resource graph

For the cluster, be precise about the difference between a **container hitting its own CPU limit** and **the underlying machine running out of CPU**. These have completely different fixes. Check both and say which one is happening.

### Section 4 — Whose problem is it: Azure's, or ours?

This is the most important section. Produce a table:

| Problem | Azure's fault or ours? | How confident | Why |
|---|---|---|---|

For each problem, decide whether it is:

- **Our own application** — something in how the application is written or configured
- **A genuine Azure platform fault** — Azure itself is not behaving as it should

Be honest and specific. If the evidence only shows a symptom and cannot prove the cause, say so rather than guessing. Then state plainly, in one sentence: **is a Microsoft support case justified here, yes or no, and why.**

### Section 5 — What we should do about it

For each problem, give the recommended fix in plain English, then the technical detail underneath. Order them by how much customer benefit each delivers. Separate:

- What to do **now** to stop the pain
- What to change **properly** so it does not recur

State clearly that you have not changed anything and that every action needs human approval.

### Section 6 — Technical appendix

For the engineers in the room: the exact KQL queries you ran and the raw results. Keep all jargon in this section so the earlier sections stay readable.

## Tone

Short sentences. No unexplained acronyms. Prefer "the shopping basket database was rejecting requests because it had been asked to do too much at once" over "Cosmos DB returned HTTP 429 due to RU exhaustion" — then give the technical phrasing in brackets afterwards.

Produce the final output as a **PDF**.

---
