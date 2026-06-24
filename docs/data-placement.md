# Data placement guide

## Why Cosmos DB for catalogue-style data
- Product documents have flexible attributes that vary by category.
- The read path needs low-latency access for list and detail pages.
- Cart, reviews, telemetry, and SRE investigations are naturally document-shaped.

## Why Azure SQL for transactional data
- Orders, pricing, customers, and inventory require transactional integrity.
- Checkout benefits from relational modelling, deterministic writes, and simple reporting joins.
- SQL Serverless keeps demo cost low while preserving familiar tooling.

## Recommended split in this demo
| Domain | Store | Rationale |
|---|---|---|
| Catalogue | Cosmos DB | Flexible schema, fast reads |
| Cart | Cosmos DB | User-scoped, ephemeral, high-frequency updates |
| Reviews | Cosmos DB | Document model, product partitioning |
| Orders / OrderItems | Azure SQL | Transactional writes and reporting |
| Customers / Addresses | Azure SQL | System of record |
| Pricing / Inventory | Azure SQL | Relational consistency and operational updates |
| SRE Investigations / Demo events | Cosmos DB | JSON report persistence and audit-style event logs |

## Anti-patterns to avoid
- Hot partition keys that collapse write traffic onto a single partition.
- Querying by id when the partition key is known and point reads are possible.
- Storing large opaque blobs inside catalogue documents.
- Treating order history as a document store workload when joins and reporting matter.
