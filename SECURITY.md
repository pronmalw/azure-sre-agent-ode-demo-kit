# Security Policy

## Important — Read Before Contributing

This repository contains a **demo application** for internal Microsoft use.

### What must NEVER be committed

- Azure subscription IDs or tenant IDs
- Service principal credentials or client secrets
- Azure SQL connection strings with real passwords
- Cosmos DB keys or connection strings
- Application Insights instrumentation keys (use placeholder)
- kubeconfig files or AKS credentials
- `.env` files with real values
- Any real customer data
- Payment card data (even test/fake card numbers that resemble real PANs)
- Any personally identifiable information (PII)

### Safe patterns

- Use `.env.example` with placeholder values only
- Use `k8s/secret-template.yaml` — never commit populated secrets
- Use Azure Key Vault references or environment variables injected at deploy time
- Use `@secure()` in Bicep for sensitive parameters

### Reporting a security issue

If you find a security issue in this demo kit, please report it to your Microsoft security contact or via the [Microsoft Security Response Center](https://msrc.microsoft.com).

Do not open a public GitHub issue for security vulnerabilities.
