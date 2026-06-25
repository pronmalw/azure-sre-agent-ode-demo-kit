# Contoso Retail — SRE Agent Knowledge Base

## Application Overview

**Workload name:** Contoso Retail (Azure SRE Agent ODE Reduction Demo)  
**Environment:** `rg-sreagent-ode-demo` / West Europe  
**Architecture:** React SPA → nginx reverse proxy → Node.js Express API → Azure Cosmos DB + Azure SQL

## Resource Inventory

| Resource | Name | Type |
|---|---|---|
| AKS Cluster | `aks-contoso-sreagent-demo` | Kubernetes (1.34, 2× Standard_D2s_v3) |
| Container Registry | `acrcontosoeuqicty6gdfys` | ACR |
| Cosmos DB | `cosmos-euqicty6gdfys` | NoSQL (serverless, multi-container) |
| SQL Server | `sql-euqicty6gdfys` | Azure SQL |
| SQL Database | `contoso-retail-db` | Azure SQL DB |
| App Insights | `appi-euqicty6gdfys` | Application Insights |
| Log Analytics | `law-euqicty6gdfys` | Log Analytics workspace |
| Storage | `stcontosoeuqicty6gdfys` | Blob storage |

## Kubernetes Namespace and Pods

- **Namespace:** `contoso-retail`
- **Deployments:** `contoso-retail-api` (2 replicas), `contoso-retail-web` (2 replicas)
- **Services:** `contoso-retail-api` (ClusterIP:3001), `contoso-retail-web-public` (LoadBalancer:80)
- **Health endpoint:** `GET /health` on port 3001

## Cosmos DB Containers

| Container | Partition Key | Notes |
|---|---|---|
| Products | `/category` | Product catalogue, 20 seeded items |
| Carts | `/userId` | Shopping cart state |
| Orders | `/userId` | Order history |
| ProductsNoIndex | `/category` | Intentional: missing indexing policy for demo |
| DemoTelemetry | `/type` | Demo incident events and chaos timeline |

## SQL Tables

- `customers` — user accounts
- `orders` — transactional order records
- `order_items` — line items per order
- `products` (pricing) — price catalogue
- `inventory` — stock levels per warehouse region

## Chaos Toggle System

The application has a controlled anti-pattern system reachable at `GET /api/ops` and `POST /api/chaos/<toggle>/on|off`.

| Toggle | Path | Anti-Pattern |
|---|---|---|
| `hotPartition` | `/api/chaos/hotPartition/on` | All writes to a single Cosmos partition key |
| `metadataThrottling` | `/api/chaos/metadataThrottling/on` | Re-reads metadata on every request |
| `multipleClients` | `/api/chaos/multipleClients/on` | Creates a new CosmosClient per request |
| `highCpu` | `/api/chaos/highCpu/on` | CPU burn loop on every API request |
| `crossPartitionQuery` | `/api/chaos/crossPartitionQuery/on` | Forces cross-partition queries |
| `largeDocument` | `/api/chaos/largeDocument/on` | Writes 1 MB documents to Cosmos |
| `missingIndexing` | `/api/chaos/missingIndexing/on` | Routes queries to unindexed container |
| `pointReadMisuse` | `/api/chaos/pointReadMisuse/on` | Uses query instead of point read |
| `sqlSlowQuery` | `/api/chaos/sqlSlowQuery/on` | Issues unoptimised SQL scan queries |
| `sqlConnectionPressure` | `/api/chaos/sqlConnectionPressure/on` | Opens new SQL connections per request |
| Reset all | `/api/chaos/reset` | Disables all toggles, returns to healthy |

**All toggles are disabled by default. Enabling them is safe — affects only this demo resource group.**

## Incident Symptom Matrix

| Chaos Toggle | Cosmos 429s | Cosmos RU Spike | Host CPU | Latency | SQL Impact |
|---|---|---|---|---|---|
| hotPartition | High | Yes | Low | High | None |
| metadataThrottling | Medium | Yes | Low | Medium | None |
| multipleClients | Medium | Yes | Medium | Medium | None |
| highCpu | None | None | High | High | None |
| crossPartitionQuery | Low | High | Low | Medium | None |
| largeDocument | Medium | Very High | Low | High | None |
| missingIndexing | None | High | Low | Medium | None |
| pointReadMisuse | Low | High | Low | Low | None |
| sqlSlowQuery | None | None | Low | Medium | High |
| sqlConnectionPressure | None | None | Medium | Medium | High |

## Expected Incident Classification

When multiple toggles active (`hotPartition` + `multipleClients` + `highCpu`):

- **Primary:** `APPLICATION_OR_CLIENT_SIDE`
- **Secondary:** `HOST_OR_RUNTIME`, `DATABASE_CONFIG_OR_DATA_MODEL`
- **Confidence:** HIGH
- **Do NOT escalate to:** Azure / Cosmos DB service team unless server-side latency or availability degrades independently

## Recovery Runbook

### Immediate Safe Actions (no approval needed)

1. `POST /api/chaos/reset` — disables all chaos toggles
2. Verify `/health` returns `status: healthy` and `cosmos429Count: 0`
3. Confirm p99 latency returns below 200ms

### Approval-Required Actions

1. Re-enable indexing on `ProductsNoIndex` container if deployed to production-like environment
2. Cosmos throughput/autoscale changes — review cost impact first

### Do NOT Do

- Do not treat Cosmos 429s from this demo as Azure service incident
- Do not increase RU as permanent fix for hot partition
- Do not escalate to Azure Support until server-side latency shows degradation independently
- Do not leave chaos toggles enabled

## KQL Queries for Investigation

### Active Chaos State
```kql
customEvents
| where name == "ChaosToggle"
| summarize arg_max(timestamp, *) by tostring(customDimensions["toggle"])
| project toggle = tostring(customDimensions["toggle"]), enabled = tobool(customDimensions["enabled"]), timestamp
```

### p99 Request Latency
```kql
requests
| summarize p99=percentile(duration, 99), p95=percentile(duration, 95), p50=percentile(duration, 50) by bin(timestamp, 1m)
| render timechart
```

### Cosmos 429 Count
```kql
dependencies
| where type == "Azure DocumentDB"
| where resultCode == "429"
| summarize count() by bin(timestamp, 1m)
| render timechart
```

### Host CPU Correlation
```kql
performanceCounters
| where counter == "% Processor Time"
| summarize avg(value) by bin(timestamp, 1m)
| render timechart
```

## Demo Flow for Customer Presentation

1. **Healthy state:** Open `http://48.207.241.23` — fast product browsing, checkout works
2. **Trigger incident:** `POST /api/chaos/hotPartition/on`, `POST /api/chaos/multipleClients/on`, `POST /api/chaos/highCpu/on`
3. **Observe degradation:** Latency rises, health shows 429s
4. **Ask SRE Agent:** "What is causing the latency increase in the Contoso Retail app?"
5. **SRE Agent investigates:** Reads App Insights, Log Analytics, Cosmos metrics, AKS pod logs
6. **Review output:** Evidence-backed classification, safe action plan, do-not-do guidance
7. **Apply fix:** `POST /api/chaos/reset`
8. **Verify recovery:** Health returns green, SRE Agent confirms p99 normalised

## Contact / Ownership

- **Team:** Contoso Platform Engineering
- **Oncall:** SRE rotation (demo only)
- **Escalation:** Do not escalate Azure/Cosmos service issues unless confirmed server-side
