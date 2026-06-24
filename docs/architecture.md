# Architecture

## Runtime topology
- **AKS** hosts two deployments: `contoso-retail-api` and `contoso-retail-web`.
- **Azure Cosmos DB** stores catalogue, cart, reviews, telemetry, and SRE investigations.
- **Azure SQL Database** stores pricing, customers, inventory, orders, and order items.
- **Application Insights + Log Analytics** collect telemetry for incident investigations and KQL dashboards.
- **Azure Container Registry** stores API and web container images.

## Request flow
1. Browser loads the React SPA from the web deployment.
2. SPA proxies `/api` requests to the Express API.
3. API reads catalogue and cart information from Cosmos DB.
4. API joins pricing and order information through Azure SQL.
5. Ops panel and SRE Agent pages read health and investigation endpoints.
