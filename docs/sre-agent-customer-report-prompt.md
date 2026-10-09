# SRE Agent — Customer-Ready Incident Report Prompt

A reusable prompt for **https://sre.azure.com/** that produces a figure-heavy, non-technical PDF
incident report for a customer.

Only the small **SCOPE** block at the top is environment-specific. Everything below it is generic
and works against any Azure workload. The prompt makes the agent **discover** the topology rather
than being told it — which is both more reusable and more convincing in a demo, because the
audience watches the agent work the problem out.

For this repo's demo environment, use:

```
SUBSCRIPTION   : d095c6c9-21e9-4fec-bfb0-429d1409e8e0
RESOURCE GROUP : rg-sreagent-ode-demo
```

**Before running:** start the scenario (`scripts\demo-control.ps1 allon`), wait **~15 minutes** so
alerts evaluate and diagnostic logs ingest, and confirm `activeIncident: true` at
`http://<app-ip>/api/ops`. Running against a healthy system yields a correct but empty report.

---

## The prompt

````text
You are the Site Reliability Engineer on call for this workload.

Produce ONE customer-ready PDF incident report. It goes directly to a business audience —
operations managers and executives — who do not know what Kubernetes, a request unit, a
partition key or a p99 is. It must also survive scrutiny from their engineers.

════════════════════════════════════════════════════════════════════
SCOPE  (the only thing you are told — discover everything else)
════════════════════════════════════════════════════════════════════

SUBSCRIPTION   : <subscription id>
RESOURCE GROUP : <resource group>
TIME WINDOW    : the last 2 hours

Everything else in this prompt is method, not answers. Do not assume any topology,
resource name, threshold or cause. Measure it.

════════════════════════════════════════════════════════════════════
PART 0 — HOW THE REPORT MUST LOOK (read before analysing)
════════════════════════════════════════════════════════════════════

This prompt is long. The REPORT MUST BE SHORT.

• MAXIMUM 8 pages.
• MINIMUM 7 figures. Figures carry the message; text only labels them.
• No block of prose over 60 words. Prefer tables and diagrams to paragraphs.
• No unexplained jargon. First use of any technical term gets a short plain-English
  gloss in brackets — e.g. "throttling (the database refusing extra work to protect
  itself)".
• Every number carries its unit and when it was measured.
• Consistent colour, key stated once: GREEN healthy, AMBER degraded, RED failing,
  GREY no data.
• Write numbers as a non-technical reader reads them: "7.5 seconds" not "7483ms";
  "95% of its allowance" not "0.95 cores". Put the technical form in brackets if needed.

════════════════════════════════════════════════════════════════════
PART 1 — DISCOVER THE ENVIRONMENT
════════════════════════════════════════════════════════════════════

Before diagnosing anything, inventory the resource group and establish the request path.
Report what you find; never assume a standard shape.

D1. List every resource in the group. Identify: the public entry point, the compute tier,
    every data store, every network component, and the observability stack
    (Log Analytics workspace, Application Insights).

D2. For EVERY data store, record its CAPACITY MODE and any configured limit — serverless
    vs provisioned, autoscale ceiling, provisioned throughput, tier, vCore count.
    This single attribute usually decides the classification in PART 3, because a store
    can only be throttled against a limit that exists.

D3. Determine the ACTUAL request path end to end. Specifically establish, with evidence,
    whether data stores are reached over private endpoints or public service endpoints,
    and whether any VPN or ExpressRoute circuit is in the customer-facing data path or
    only carries back-office traffic. Never draw a network component into the user's
    request path without confirming traffic actually traverses it.

D4. For each compute workload record replica count, autoscaler presence and settings, and
    CPU/memory requests AND limits. A limit the customer chose is a frequent root cause.

D5. List the configured alert rules and what each one actually tests.

Carry this inventory into FIGURE 1. If anything cannot be determined, say so explicitly.

════════════════════════════════════════════════════════════════════
PART 2 — QUERY DISCIPLINE (generic traps that invert conclusions)
════════════════════════════════════════════════════════════════════

TIME WINDOW
  Use the window given in SCOPE for every query — never mix windows.
  First, locate the incident start yourself (first alert fired, or the first clear
  inflection in the metrics). Then split the window at that moment and measure
  baseline and incident SEPARATELY from real data:

    | extend Phase = iff(TimeGenerated < datetime(<incident start>), "Baseline", "Incident")
    | summarize ... by Phase

  Never estimate a baseline. If the window contains no healthy period, say so.

Q1. DETERMINE THE TABLE SCHEMA BEFORE QUERYING.
    Workspace-based Application Insights exposes AppRequests, AppDependencies, AppMetrics,
    AppEvents, AppTraces. Classic exposes requests, dependencies, customMetrics. Querying
    the wrong set returns NOTHING rather than an error, which reads as "no problem found".
    Confirm which tables actually hold rows before drawing any conclusion from emptiness.

Q2. NEVER FILTER A RESOURCE BY NAME FRAGMENT — ENUMERATE AND GROUP.
    Resource names frequently share prefixes, so a name filter can silently exclude the
    very resource that is failing while appearing to succeed. Always filter broadly, then
    group, so every participant appears in the output and zero-rows is visible:

      AppDependencies
      | where TimeGenerated between (<window>)
      | summarize Calls = count(), Failures = countif(Success == false),
                  Throttled = countif(ResultCode == "429") by Target, Type

    Cross-check client-side observations against the platform's own logs, which cover every
    account regardless of what the client reports:

      AzureDiagnostics
      | where TimeGenerated between (<window>)
      | summarize Total = count(), Throttled = countif(statusCode_s == "429")
                  by ResourceProvider, Resource

    If two data stores exist and only one shows throttling, that asymmetry is a FINDING —
    explain it from their capacity modes (D2), do not average it away.

Q3. NEVER AGGREGATE CPU ACROSS CONTAINERS OR NODES — GROUP BY INSTANCE.
    A busy container averaged with idle system containers disappears. Grouping typically
    reveals one workload pinned at its limit where the cluster-wide mean looks idle.
    For AKS, CPU is in the Perf table (ObjectName "K8SContainer" / "K8SNode",
    CounterName "cpuUsageNanoCores"; divide by 1e9 for cores), not InsightsMetrics.

      Perf
      | where TimeGenerated between (<window>)
      | where ObjectName == "K8SContainer" and CounterName == "cpuUsageNanoCores"
      | extend Cores = CounterValue / 1000000000.0
      | summarize AvgCores = avg(Cores), MaxCores = max(Cores) by InstanceName
      | order by MaxCores desc

Q4. SEPARATE "AT ITS OWN LIMIT" FROM "OUT OF CAPACITY".
    Compare each workload against ITS OWN configured limit, and separately compare the
    node/host against its physical capacity. A container at 95% of its own limit on a
    host that is 30% idle is a LIMIT problem — the fix is to raise the limit, not to buy
    hardware. Reversing these sends the customer to spend money that changes nothing.

Q5. SEPARATE TOTALS FROM PER-OPERATION COST.
    Total consumption (RU, DTU, CPU-seconds, calls) rises naturally with traffic and
    proves nothing about efficiency. Cost PER OPERATION rising while traffic is flat is
    what proves the access pattern became wasteful. Always compute and present both, and
    base any efficiency claim on the per-operation figure.

Q6. UNDERSTAND TRAFFIC SHAPE BEFORE READING MEANING INTO VOLUME.
    Request-table volume may be low by design — background work, in-process calls, batch
    jobs and internal traffic often never create request records. Verify the normal ratio
    of dependency calls to requests in the BASELINE period before treating a quiet table
    as an outage. A high dependency-to-request ratio is itself a finding worth showing.

Q7. CHECK CONTROL-PLANE STATE PER RESOURCE, NOT FROM LIST CALLS.
    List operations frequently return empty or stale status fields. Query each connection,
    gateway or endpoint individually via Azure Resource Manager for its true state.

Q8. DISTINGUISH SLOW FROM FAILING.
    High latency with a zero error count means degraded, not broken. Do not describe lost
    orders, failed transactions or dropped requests unless a success-rate or error metric
    actually shows them. State the success rate you measured.

Q9. EMPTY RESULTS ARE A RESULT.
    If a query returns no rows, SAY SO and mark that figure GREY / "no data". Never
    estimate, illustrate, extrapolate or carry a number in from another window.
    Label every figure [MEASURED] (you queried it) or [SELF-REPORTED] (the application
    asserted it). Where the two disagree, show both and investigate — assume your query
    is wrong before assuming the telemetry is wrong.

════════════════════════════════════════════════════════════════════
PART 3 — THE ANALYSIS
════════════════════════════════════════════════════════════════════

STEP 1 — DETECT
  Which alerts fired, at what UTC time, in what order? What did a real user experience?
  Quantify in human terms: seconds of wait, share of sessions affected, transactions lost
  (only if a success metric actually dropped).

STEP 2 — MEASURE
  Baseline vs incident, with units, for every signal you can evidence: end-to-end response
  time (p50 and p99), per-operation data-store cost, throttled/failed calls, compute against
  its limit, query latency, error counts, packet loss, connectivity state, success rate.

STEP 3 — CLASSIFY  ← the central question the report must answer
  Give ONE primary classification plus contributing factors, each with its specific
  evidence row and a confidence score out of 10.

  (A) AZURE PLATFORM FAULT — an Azure service failed to deliver what Microsoft commits to.
      Requires: Service Health or Resource Health evidence, or service-side degradation
      with no corresponding change in client behaviour.
      CRITICAL AND COUNTER-INTUITIVE: a throttling response (429) raised after a
      customer-configured limit is exceeded is NOT a platform fault. That is the platform
      functioning exactly as designed and protecting the service. It belongs in (B) or (C).
      Likewise a timeout caused by the client asking for too much is not a platform fault.

  (B) APPLICATION / CODE FAULT — the code makes the platform do unnecessary work.
      Evidence: per-operation cost rising while traffic is flat; queries scanning broadly
      instead of seeking; missing or unused indexes; repeated fetches of identical data;
      connection or client objects created per call instead of pooled; oversized payloads;
      CPU burned inside the application.

  (C) CUSTOMER CONFIGURATION / CAPACITY — code is reasonable, environment is not.
      Evidence: a resource pinned exactly at a customer-chosen ceiling; a single replica
      with no autoscaler; an undersized tier; a credential, key or setting mismatch;
      drift from intended configuration.

  Present as a traffic-light table covering ALL THREE, so the reader sees what was RULED
  OUT and why. Ruling Azure out, with evidence, is as valuable to the customer as finding
  the cause — and more credible than a report that only accuses.

STEP 4 — ROOT CAUSE
  Causal chain as a diagram, not prose: trigger → mechanism → symptom → business impact.
  Maximum 5 links. Then one sentence a non-technical reader will remember.

STEP 5 — FIX
  For each recommendation: what to change, which category it addresses, expected effect
  with a number, effort (Low/Med/High), and whether it is immediate mitigation or
  permanent remedy. Separate "stop the bleeding" from "stop it recurring".

STEP 6 — PROVE RECOVERY
  If the system has returned to healthy, show the after-numbers against the SAME measured
  baseline and list which checks pass. If still active, label the section
  "Not yet verified" and say so plainly.

STEP 7 — VALUE
  State time-to-detect and time-to-root-cause achieved here. Contrast with the manual
  alternative: name the specific dashboards, tables and correlations a human would have
  had to join by hand, and name the specific trap in PART 2 that would most plausibly
  have led them to the wrong conclusion in this particular incident.

════════════════════════════════════════════════════════════════════
PART 4 — REQUIRED FIGURES (minimum 7)
════════════════════════════════════════════════════════════════════

FIG 1  ARCHITECTURE — left-to-right, landscape, built from your PART 1 discovery.
       User → entry point → compute → data stores, each data store labelled with its
       capacity mode and limit. Show the observability stack collecting from everything
       and the SRE Agent reading from it. Draw any component NOT in the user request path
       off to one side, explicitly annotated as such. Colour every component by its
       measured state.
FIG 2  DETECTION TIMELINE — alerts on a time axis in firing order with severity;
       mark incident start and recovery.
FIG 3  BEFORE vs DURING — grouped bars per KPI, baseline beside incident, multiple called
       out ("18x slower"). Plain labels: "Page wait", "Cost per action", "CPU used".
FIG 4  CLASSIFICATION TRAFFIC LIGHT — rows: Azure platform / Application code / Customer
       configuration. Columns: Verdict, Evidence, Confidence.
FIG 5  ROOT CAUSE CHAIN — trigger → mechanism → symptom → business impact.
FIG 6  FIX PRIORITY — Impact vs Effort quadrant, each fix numbered and colour-coded by
       category.
FIG 7  RECOVERY PROOF — same KPIs as FIG 3 plus the after column, and a pass/fail checklist.
FIG 8  (if evidenced) DEPENDENCY AMPLIFICATION — downstream calls per user request.

════════════════════════════════════════════════════════════════════
PART 5 — REPORT STRUCTURE
════════════════════════════════════════════════════════════════════

Page 1  COVER — customer, incident title in plain English, exact UTC window, severity,
        and THE VERDICT IN ONE SENTENCE naming the category. Add a 4-box strip:
        What happened / Who it affected / Why / Whose responsibility it is.
Page 2  WHAT THE USER EXPERIENCED — FIG 3.
Page 3  THE ARCHITECTURE — FIG 1.
Page 4  HOW IT WAS DETECTED — FIG 2 + alert table.
Page 5  THE VERDICT — FIG 4, including the ruled-out reasoning.
Page 6  ROOT CAUSE — FIG 5 + the one-sentence takeaway.
Page 7  THE FIX — FIG 6 + fix table.
Page 8  RECOVERY & VALUE — FIG 7 + time-to-detect vs manual effort.
APPENDIX (excluded from the page count) — every query you ran with the row count it
        returned, so an engineer can reproduce each number exactly.

════════════════════════════════════════════════════════════════════
PART 6 — INTEGRITY
════════════════════════════════════════════════════════════════════

This report goes to a paying customer. Accuracy outranks completeness, and outranks a
tidy narrative.

• Never invent a number to complete a figure. An acknowledged gap is acceptable; a
  plausible fabrication is not.
• Never claim an Azure platform fault without Service Health or Resource Health evidence.
• Never claim lost transactions without a success metric that actually dropped.
• Never place a network component in the user request path without confirming traffic
  traverses it.
• If evidence is ambiguous, state the ONE additional measurement that would settle it.
• Close with: "Prepared by Azure SRE Agent · <UTC timestamp> · all figures measured from
  <workspace> over <window>."

Produce the report as a PDF, ready to send to the customer without editing.
````

---

## Why each rule exists

Every rule below was derived from a real failure observed in this environment, then generalised
so it applies to any workload.

| Rule | The failure it prevents |
|---|---|
| **D2** capacity mode first | A serverless store *cannot* throttle. Without this, "zero throttling here" gets misread as "no throttling anywhere". |
| **Q1** confirm schema | Workspace-based App Insights has no `requests`/`customMetrics` table. Wrong schema returns empty, not an error — which reads as "healthy". |
| **Q2** enumerate, never name-filter | Measured here: one account name was a *prefix* of another, so filtering on the first silently excluded **every** throttled call and inverted the report's conclusion. |
| **Q3** group by instance | Measured on identical data: grouped, the API container read **0.95 cores (95% of limit)**; cluster-averaged, **0.02 cores** — apparently healthy. |
| **Q4** limit vs capacity | Prevents recommending more nodes when one container simply had too low a limit. |
| **Q5** per-operation vs total | Total RU rises with traffic; only per-operation cost proves inefficiency. Measured: 2.61 → 8.5 RU/op at flat traffic. |
| **Q6** traffic shape | This app generates load in-process, so request volume is sparse by design. Easily misread as an outage. |
| **Q7** per-resource state | `az network vpn-connection list` returns `connectionStatus: undefined`; only `show` gives truth. |
| **Q8** slow ≠ failing | SQL latency hit 7.3s with **zero** errors and a 100% success rate. "Lost orders" would have been fabrication. |
| **Q9** empty is a result | The single largest source of confident, wrong reporting. |
| **(A)** 429 ≠ platform fault | The most important classification nuance — and the one that decides whether the customer blames Microsoft or fixes their own config. |

## Live validation

Run against a full 11-fault incident beginning **2026-10-09 08:46:12 UTC**:

| Signal | Result |
|---|---|
| Alert rules fired | **7 of 7** within 8 minutes |
| Throttling, provisioned store | 3,190 throttled / 61,341 |
| Throttling, serverless store | **0 / 2,566** — confirms serverless cannot 429 |
| API container CPU | 0.95 of a 1-core limit |
| Per-operation cost | 8.5 RU/op incident vs **2.61** baseline |
| p99 latency | 569 → 1,426 ms |
| SQL | 7,257 ms, **0 errors**, 100% checkout success |

Ingestion lag: alerts from ~3 min, platform diagnostics from ~5 min. Wait 15 minutes before
running for every figure to have data.
