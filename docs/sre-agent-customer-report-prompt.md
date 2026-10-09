# SRE Agent — Customer-Ready Incident Report Prompt

Paste the block below into the agent chat at:

<https://sre.azure.com/agents/subscriptions/d095c6c9-21e9-4fec-bfb0-429d1409e8e0/resourceGroups/rg-sreagent-ode-demo/providers/Microsoft.App/agents/contoso-sre-agent>

**Before you run it:** trigger the scenario on `/ops` (or `scripts\demo-control.ps1 allon`), let it run for
**at least 15 minutes** so alerts evaluate and Cosmos diagnostics ingest, then run the prompt while the
incident is still active. Run it a second time after **Reset to Healthy** if you want the recovery proof
section populated with real post-fix numbers.

If the system is healthy when you run it, the agent will correctly report "no incident" — which is
accurate but makes a poor demo. Always confirm `activeIncident: true` at
`http://48.207.241.23/api/ops` first.

**Agent permissions are confirmed sufficient** — the user-assigned identity
`contoso-sre-agent-jb7xjzlhg7v5w` holds Log Analytics Reader, Monitoring Contributor (subscription
scope, which grants Resource Health reads), DocumentDB Account Contributor, AKS RBAC Reader and
Application Insights Component Contributor. Every query this prompt asks for will authorise.

---

## The prompt

````text
You are the Site Reliability Engineer on call for Contoso Retail, an online shop running on Azure.

Produce ONE customer-ready PDF report. It will be handed directly to a business audience —
store operations managers and executives — who do not know what Kubernetes, Cosmos DB,
a request unit or a partition key is. It must also stand up to scrutiny from their engineers.

════════════════════════════════════════════════════════════════════════
PART 0 — HOW THIS REPORT MUST LOOK (read before you analyse anything)
════════════════════════════════════════════════════════════════════════

This prompt is long. The REPORT MUST BE SHORT.

Hard rules:
• MAXIMUM 8 pages.
• MINIMUM 7 figures. Figures carry the message; text only labels them.
• No section of prose may exceed 60 words. Prefer tables and diagrams to paragraphs.
• No unexplained jargon. First use of any technical term gets a 6-word plain-English gloss
  in brackets. Example: "throttling (the database refusing extra work to protect itself)".
• Every number in the report must carry its unit and the time it was measured.
• Use colour consistently and state the key once: GREEN = healthy, AMBER = degraded,
  RED = failing, GREY = no data.
• Write numbers the way a non-technical reader reads them: "7.5 seconds", not "7483ms";
  "96 out of 100" or "96%", not "0.96 cores of a 1 core limit" (put the technical form in
  brackets afterwards if it matters).

════════════════════════════════════════════════════════════════════════
PART 1 — ENVIRONMENT (verified ground truth — use exactly, do not invent)
════════════════════════════════════════════════════════════════════════

Subscription   : d095c6c9-21e9-4fec-bfb0-429d1409e8e0
Resource group : rg-sreagent-ode-demo  (West Europe)

Compute
  AKS cluster  : aks-contoso-sreagent-demo
  Namespace    : contoso-retail
  Workloads    : contoso-retail-api — 1 replica, CPU request 250m, CPU LIMIT 1 core, NO autoscaler
                 contoso-retail-web — 2 replicas, autoscaler 2-10 at 70% CPU
  Nodes        : 2 x Standard_D2s_v3 (2 vCPU each)
  Entry point  : Azure Load Balancer, public IP 48.207.241.23

Data
  Cosmos DB    : TWO SEPARATE ACCOUNTS. You must look at both.
                 (a) cosmos-euqicty6gdfys           — SERVERLESS. By design it auto-scales
                     and CANNOT return 429 throttling. Zero 429s here is normal and
                     proves nothing.
                 (b) cosmos-throttle-euqicty6gdfys  — PROVISIONED at 400 RU/s.
                     ALL genuine throttling happens here.
  Azure SQL    : sql-euqicty6gdfys / contoso-retail-db

Network
  VNets        : vnet-euqicty6gdfys (main), vnet-onprem-sim-euqicty6gdfys (simulated branch site)
  VPN gateways : vpngw-main-euqicty6gdfys, vpngw-onprem-euqicty6gdfys
  Connections  : conn-main-to-onprem-euqicty6gdfys, conn-onprem-to-main-euqicty6gdfys
  CRITICAL     : Cosmos DB and Azure SQL are reached over PUBLIC service endpoints.
                 There are NO private endpoints. Customer shopping traffic DOES NOT
                 travel through the VPN. The VPN carries back-office/branch traffic only.
                 Do NOT draw or describe shoppers' requests as passing through the VPN.

Observability
  App Insights : appi-euqicty6gdfys   (workspace-based)
  Workspace    : law-euqicty6gdfys    (ID 527754b0-cdd5-467a-9128-4f3a4a173b16)
  Alert rules  : contoso-p99-latency, contoso-host-cpu-saturation, contoso-cosmos-throttling,
                 contoso-cosmos-429, contoso-sql-slow-query, contoso-vpn-tunnel-down,
                 contoso-vpn-packet-loss  → all route to action group ag-sre-demo

════════════════════════════════════════════════════════════════════════
PART 2 — HOW TO QUERY (these exact traps have produced wrong reports before)
════════════════════════════════════════════════════════════════════════

TIME WINDOW: the LAST 60 MINUTES. State the exact UTC window on the cover page and use
the identical window for every query. Never mix windows.

1. This App Insights instance is WORKSPACE-BASED. The tables `requests`, `traces`,
   `customMetrics` and `customEvents` DO NOT EXIST. Use:
   AppRequests, AppDependencies, AppMetrics, AppEvents, AppTraces.

2. THE COSMOS TRAP — this one inverted a previous report's conclusion.
   "cosmos-euqicty6gdfys.documents.azure.com" is NOT a substring of
   "cosmos-throttle-euqicty6gdfys.documents.azure.com".
   Filtering on the primary account name SILENTLY EXCLUDES every throttled call and makes
   a heavily throttled system look perfectly healthy. Always filter broadly, then group:

     AppDependencies
     | where TimeGenerated between (datetime(<START>) .. datetime(<END>))
     | where Target has "documents.azure.com"
     | summarize Calls = count(), Throttled = countif(ResultCode == "429") by Target

   Cross-check against the Azure platform's own logs, which cover both accounts:

     AzureDiagnostics
     | where TimeGenerated between (datetime(<START>) .. datetime(<END>))
     | where ResourceProvider == "MICROSOFT.DOCUMENTDB"
     | summarize Total = count(), Throttled = countif(statusCode_s == "429") by Resource

3. CPU lives in the `Perf` table, NOT `InsightsMetrics`:
     Perf | where ObjectName == "K8SContainer" and CounterName == "cpuUsageNanoCores"
   Divide by 1,000,000,000 for cores. Repeat with ObjectName == "K8SNode" for node totals.
   Always distinguish CONTAINER-AGAINST-ITS-LIMIT from NODE-AGAINST-ITS-CAPACITY.
   The API container limit is 1 core; a node has 2 vCPU. A container at 95% of its own
   limit on a node that is only 35% busy is a LIMIT problem, not a capacity problem.

4. The application publishes its own measurements as `contoso.*` metrics in AppMetrics.
   Read them as: Value = Sum / todouble(ItemCount). Available:
     contoso.latencyP50Ms, contoso.latencyP99Ms, contoso.ruUsage, contoso.ruPerOperation,
     contoso.cosmos429Count, contoso.sqlQueryLatencyMs, contoso.sqlErrorCount,
     contoso.hostCpuPercent, contoso.checkoutSuccessRate, contoso.vpnTunnelDown,
     contoso.networkPacketLossPercent, contoso.activeToggleCount
   Note `contoso.ruUsage` is the TOTAL for the window; `contoso.ruPerOperation` is the
   average cost of a SINGLE database operation. Only the per-operation figure tells you
   whether the access pattern is wasteful. Rising total RU may just mean more shoppers.

5. AppRequests is SPARSE BY DESIGN (roughly 870/hour). Background traffic is generated
   in-process and does not create HTTP request records. Low AppRequests volume is NOT
   evidence of an outage or of low traffic. Dependency calls outnumber requests by
   roughly 500:1 — that amplification is itself a finding worth showing.

6. Check the real control-plane state of BOTH VPN connections individually via Azure
   Resource Manager. A listing call can report an empty status; query each connection.

7. If a query returns no rows, SAY SO and mark that figure GREY / "no data".
   NEVER estimate, illustrate, extrapolate, or carry a number from a different window.
   Label every figure [MEASURED] (you queried it) or [SELF-REPORTED] (the application
   told you). Where both exist and disagree, show both and investigate the gap —
   assume your query is wrong before you assume the application metric is wrong.

8. If `contoso.sqlErrorCount` is 0, SQL is SLOW, not FAILING. Do not describe failed or
   dropped orders unless `contoso.checkoutSuccessRate` is actually below 1.

════════════════════════════════════════════════════════════════════════
PART 3 — THE ANALYSIS YOU MUST PERFORM
════════════════════════════════════════════════════════════════════════

STEP 1 — DETECT
  Which alert rules fired, at what UTC time, and in what order?
  What did a shopper actually experience? Quantify in human terms:
  page wait in seconds, percentage of baskets affected, orders lost (only if
  checkoutSuccessRate < 1).

STEP 2 — MEASURE
  For each signal below, report HEALTHY BASELINE vs DURING INCIDENT, with units:
  page response time (p50 and p99), database cost per operation, throttled database
  calls, application CPU against its limit, SQL query time, SQL errors,
  network packet loss, VPN tunnel state, checkout success rate.

STEP 3 — CLASSIFY  ← the central question this report must answer
  Assign ONE primary classification, plus any contributing factors, each with the
  specific evidence and a confidence score out of 10.

  (A) AZURE PLATFORM FAULT — an Azure service failed to do what Microsoft promises.
      Qualifying evidence: Azure Service Health or Resource Health showing degradation;
      service-side latency high while client behaviour is unchanged; errors with no
      corresponding client cause.
      IMPORTANT AND NON-OBVIOUS: a 429 throttling response after a customer-provisioned
      limit is exceeded is NOT a platform fault. That is Azure working exactly as
      designed, protecting the service. Classify it under (B) or (C).

  (B) APPLICATION / CODE FAULT — the code asks Azure to do unnecessary or wasteful work.
      Qualifying evidence: cost per database operation rising while traffic is flat;
      queries scanning every partition instead of one; missing indexes; the same data
      fetched repeatedly; multiple database client instances where one is correct;
      oversized documents; CPU burned inside the application.

  (C) CUSTOMER CONFIGURATION / CAPACITY — the code is reasonable but the environment is
      under-provisioned or misconfigured.
      Qualifying evidence: a resource sitting exactly at a limit the customer chose
      (e.g. a 400 RU/s ceiling, a 1-core container limit, a single replica with no
      autoscaler); a credential or key mismatch; a setting drifted from intended state.

  Present the verdict as a traffic-light table across all three categories, so the reader
  can see what was RULED OUT and why — not only what was ruled in. Ruling Azure out is
  as valuable to the customer as finding the cause.

STEP 4 — ROOT CAUSE
  Give the causal chain as a diagram, not prose: trigger → mechanism → symptom →
  business impact. Maximum 5 links. Then state the single sentence a non-technical
  reader should remember.

STEP 5 — FIX
  Recommend specific, actionable fixes. For each: what to change, which of the three
  categories it addresses, expected effect with a number, effort (Low/Med/High),
  and whether it is an immediate mitigation or a permanent fix.
  Separate "stop the bleeding now" from "stop it happening again".

STEP 6 — PROVE RECOVERY
  If the system has since returned to healthy, show the after numbers against the same
  baseline and state which checks pass. If the incident is still active, say so plainly
  and label the section "Not yet verified".

STEP 7 — VALUE
  State time-to-detect and time-to-root-cause achieved here, and contrast with the
  manual alternative: which dashboards, logs and tables a human would have had to
  correlate by hand, and the specific trap (the two-Cosmos-account filter) that would
  most likely have sent them to the wrong conclusion.

════════════════════════════════════════════════════════════════════════
PART 4 — REQUIRED FIGURES (minimum 7)
════════════════════════════════════════════════════════════════════════

FIGURE 1 — Architecture, left-to-right, landscape.
  Shopper → Load Balancer → web pods → API pod → Cosmos DB (both accounts, labelled
  with their modes) and Azure SQL. Show App Insights / Log Analytics collecting from
  everything, and the SRE Agent reading from Log Analytics.
  Draw the VPN and the branch-site VNet OFF to one side, clearly annotated
  "back-office only — shopper traffic does not pass through here".
  Colour each component GREEN/AMBER/RED by its measured state in this incident.

FIGURE 2 — Detection timeline. Alerts on a time axis in the order they fired,
  with severity. Mark "incident begins" and, if applicable, "recovery".

FIGURE 3 — Before vs during, as a bar chart per KPI, baseline alongside incident
  value, with the multiple called out ("18x slower"). Use plain labels: "Page wait",
  "Database cost per action", "App CPU used", "Database query time".

FIGURE 4 — Classification traffic-light table. Rows = Azure platform / Application code /
  Customer configuration. Columns = Verdict, Evidence, Confidence.

FIGURE 5 — Root cause chain. Trigger → mechanism → symptom → business impact.

FIGURE 6 — Fix priority. Two-by-two of Impact against Effort, each fix plotted and
  numbered, colour-coded by which category it addresses.

FIGURE 7 — Recovery proof. The same KPIs as Figure 3 with the after column, and a
  pass/fail checklist.

FIGURE 8 (if the data supports it) — The dependency amplification: database calls versus
  shopper requests, showing how one page view multiplies into many database operations.

════════════════════════════════════════════════════════════════════════
PART 5 — REPORT STRUCTURE
════════════════════════════════════════════════════════════════════════

Page 1  COVER — Customer name, incident title in plain English, exact UTC window,
        severity, and THE VERDICT IN ONE SENTENCE naming the category.
        Add a 4-box summary strip: What happened / Who it affected / Why /
        Whose responsibility it is.
Page 2  WHAT THE SHOPPER EXPERIENCED — Figure 3. Minimal words.
Page 3  THE ARCHITECTURE — Figure 1.
Page 4  HOW IT WAS DETECTED — Figure 2 + the alert table.
Page 5  THE VERDICT — Figure 4. The ruled-out reasoning matters as much as the ruled-in.
Page 6  ROOT CAUSE — Figure 5 + the one-sentence takeaway.
Page 7  THE FIX — Figure 6 + the fix table.
Page 8  RECOVERY & VALUE — Figure 7 + time-to-detect vs manual effort.
APPENDIX (does not count toward the 8 pages) — every KQL query you ran, each with the
        row count it returned, so an engineer can reproduce the result exactly.

════════════════════════════════════════════════════════════════════════
PART 6 — INTEGRITY
════════════════════════════════════════════════════════════════════════

This report goes to a paying customer. Accuracy outranks completeness and outranks
narrative neatness.

• Do not invent a number to complete a figure. An honest gap is acceptable; a plausible
  invention is not.
• Do not claim an Azure platform fault without Service Health or Resource Health evidence.
• Do not claim lost orders without checkoutSuccessRate below 1.
• Do not route shopper traffic through the VPN in any diagram or sentence.
• If the evidence is ambiguous, say which single additional measurement would settle it.
• Close with: "Prepared by Azure SRE Agent · <UTC timestamp> · all figures measured from
  <workspace> over <window>."

Produce the report as a PDF, ready to send to the customer without editing.
````

---

## Why this prompt is shaped the way it is

| Guard | What it prevents |
|---|---|
| Both Cosmos accounts named, with the substring trap spelled out | The exact error that made a previous report conclude "no throttling, not Azure's fault" when thousands of calls were being throttled |
| `AzureDiagnostics` cross-check | Catches the above even if the agent ignores the warning |
| Workspace-based table list | `requests` / `customMetrics` silently return nothing |
| `Perf`, not `InsightsMetrics` | CPU would come back empty |
| Container-limit vs node-capacity | Stops "the cluster is out of CPU" when one container hit its own 1-core cap |
| `ruUsage` vs `ruPerOperation` | Total RU rises with traffic; only per-operation cost proves inefficiency |
| AppRequests is sparse by design | Stops "traffic collapsed" being read into a quiet table |
| VPN excluded from the data path | Stops a wrong architecture diagram |
| 429 ≠ platform fault | The single most important classification nuance |
| `[MEASURED]` vs `[SELF-REPORTED]` | Keeps the application's own claims separable from independent evidence |
