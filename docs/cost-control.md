# Cost control

- **AKS (2 × Standard_D2s_v3)**: roughly $90/month when left running continuously.
- **Cosmos DB serverless**: typically a few dollars per month for demo workloads.
- **Azure SQL serverless**: about $5/month at light usage.
- **Log Analytics + App Insights**: small but usage-dependent; keep retention to 30 days.

## Cost guidance
- Delete the resource group after demos.
- Stop local Docker builds when not needed.
- Keep load generation short and controlled.
- Use the included cleanup scripts after customer sessions.
