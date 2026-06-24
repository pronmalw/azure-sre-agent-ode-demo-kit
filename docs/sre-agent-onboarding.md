# SRE Agent onboarding

1. Deploy the infrastructure and workload into the target resource group.
2. Ensure Application Insights and Log Analytics are receiving data.
3. Grant the SRE Agent access to the repository, resource group, and required telemetry scopes.
4. Validate the KQL queries under `kql/` against the workspace.
5. Dry-run the investigation workflow using `healthy-baseline.json` and one chaos scenario.
6. Tailor the prompts and skills docs for the target customer motion.
