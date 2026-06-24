# Contributing — ACE Customization & Regional Champs Guide

This demo kit is maintained for Microsoft ACEs and regional SRE Agent champs.

## Branch strategy

| Branch | Purpose |
|--------|---------|
| `main` | Stable demo — only merge tested, working code |
| `dev`  | Active development — PRs target this branch |

## How to customize for your customer

1. Fork or clone this repo to your own ACE workspace.
2. Copy `infra/parameters/dev.json` to `infra/parameters/<customer>.json`.
3. Set `customerName`, `workloadName`, `resourceGroupName`, `location`.
4. Adjust branding in `src/web/src/components/Layout.tsx`.
5. Add customer-specific scenarios in `scenarios/`.
6. Update `docs/demo-script.md` with customer-specific talking points.
7. Never commit real customer data, subscription IDs, or credentials.

## Pull requests

- Target `dev` branch for all PRs.
- Include a description of what changed and why.
- All builds and tests must pass before merge.
- Do not commit `.env` files, kubeconfig, or any secrets.

## Adding new chaos scenarios

1. Add the toggle to `src/api/src/services/chaos.service.ts`.
2. Add the endpoint to `src/api/src/routes/chaos.routes.ts`.
3. Add the classification logic to `src/classifier/src/classifier.ts`.
4. Add a scenario fixture in `scenarios/`.
5. Add a test in `tests/classifier/`.
6. Document it in `docs/ace-customization-guide.md`.

## Questions

Reach out to your regional SRE Agent champ or the EMEA SRE Agent field team.
