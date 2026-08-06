# Azure SRE Agent ODE Reduction Demo Kit

> **Reusable demo kit for Microsoft ACEs and regional SRE Agent champs.**  
> Demonstrates how Azure SRE Agent reduces operational delivery effort (ODE) by moving from customer impact → telemetry evidence → ownership classification → safe action plan → recovery verification.

## Status

🚧 **Under active development** — see `dev` branch for latest.

## Demo title

**"Azure SRE Agent for ODE Reduction — from customer impact to evidence-backed recovery."**

## Overview

This kit deploys a realistic **Contoso Retail** e-commerce workload on **AKS** backed by **Azure SQL** and **Azure Cosmos DB (NoSQL/SQL API)**, with full observability via **Application Insights** and **Log Analytics**. It includes controllable chaos toggles, an incident classifier, and SRE Agent onboarding assets.

## Quick links (fill in after deployment)

- **App URL:** _TODO after deploy_
- **Ops panel:** `<app-url>/ops`
- **SRE Agent view:** `<app-url>/sre-agent`
- **GitHub repo:** https://github.com/pronmalw/azure-sre-agent-ode-demo-kit

## Prerequisites

- Azure CLI ≥ 2.55
- kubectl ≥ 1.28
- Node.js ≥ 20 LTS
- Docker Desktop (for local container builds)
- Access to Azure subscription

## Architecture

```
[Browser]
    │
    ▼
[AKS — 2 nodes Standard_D2s_v3]
    ├── [Contoso Retail Web (React)]
    └── [Contoso Retail API (Node.js/Express)]
            ├── [Azure Cosmos DB — NoSQL/SQL API]  ← catalogue, cart, events, SRE findings
            └── [Azure SQL Database]               ← orders, customers, pricing, inventory
                        │
              [Application Insights + Log Analytics]
```

## Data placement

| Data | Store | Why |
|------|-------|-----|
| Product catalogue | Cosmos DB | Flexible attributes, low-latency reads |
| Cart / session | Cosmos DB | User-scoped, ephemeral, high-throughput |
| Orders / order lines | Azure SQL | Transactional integrity, relational joins |
| Customers / addresses | Azure SQL | System of record, referential integrity |
| Pricing master | Azure SQL | Regulatory, audit, joins with orders |
| SRE findings | Cosmos DB | Document-shaped, varies per incident |

See [`docs/data-placement.md`](docs/data-placement.md) for full guidance.

## Getting started (local)

```bash
# 1. Clone
git clone https://github.com/pronmalw/azure-sre-agent-ode-demo-kit.git
cd azure-sre-agent-ode-demo-kit

# 2. Copy env template
cp src/api/src/.env.example src/api/.env
# Edit .env — or leave blank for in-memory fallback mode

# 3. Install and run
cd src/api && npm install && npm run dev   # API on :3001
cd src/web && npm install && npm run dev   # Web on :3000
```

## Deploy to Azure (AKS default)

```powershell
.\scripts\deploy.ps1 -ResourceGroupName "rg-sreagent-ode-demo" -Location "westeurope"
```

## Demo flow (15 min)

1. Show healthy Contoso Retail website  
2. Explain SQL + Cosmos data placement  
3. Trigger incident via `/ops`  
4. Show degraded customer experience  
5. Open `/sre-agent` → run investigation  
6. Review classification, evidence, safe actions, do-not-do  
7. Reset to healthy → show recovery  
8. Close: *"Zero unnecessary escalations. That's ODE reduction."*

See [`docs/demo-script.md`](docs/demo-script.md) for the full script.

## Cleanup

```powershell
.\scripts\cleanup.ps1 -ResourceGroupName "rg-sreagent-ode-demo"
```

## Cost

~$50–100/month while running (AKS 2×D2s_v3 dominates). Delete RG between sessions.

## Intended audience

Microsoft internal ACEs and regional SRE Agent champs. See [`docs/repo-access.md`](docs/repo-access.md).
