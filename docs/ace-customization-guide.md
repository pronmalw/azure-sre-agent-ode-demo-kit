# ACE customization guide

- Update branding strings in `src/web/src/components/Layout.tsx`, `src/web/src/pages/HomePage.tsx`, and `infra/main.bicep`.
- Replace demo scenarios in `scenarios/` with customer-specific failure signatures.
- Expand the SQL schema in `src/api/src/services/sql.service.ts` and `infra/modules/azure-sql.bicep`.
- Add or remove Cosmos containers in `infra/modules/cosmos-nosql-sqlapi.bicep` and corresponding API services.
- Tailor the docs and prompts under `docs/` for regional field usage.
