# Server synchronization release — 2026-11-19

The release combines the working 5293/desktop sources with the production-only support-session changes. Production landing pages, nginx configuration, environment, object storage and payment gateways remain under their existing configuration.

## Migrations

One chain: layout01 -> support_session_shifts -> expo01 -> display01 -> vipfinance01 -> printer02 -> purchasepay01. The already-deployed support_session_shifts migration is preserved unchanged. Migration from a restored production PostgreSQL dump reached purchasepay01; all model columns were present afterward.

## Preserved behavior and fixes

- Preserve support-session JWT/refresh markers while retaining kitchen scope and branch binding.
- Exclude fully complimentary, zero-money VIP orders from paid-order income/COGS; partial cash + VIP orders remain supported.
- Keep the latest owner finance, debt repayment, supplier purchases, reports, QR menu and desktop interface changes.
- Desktop version 1.0.7. Reproducible local packaging: npm run package:release. This packaging configuration disables Windows executable resource editing/signing when the build host cannot extract code-signing-tool symlinks; no signing certificate is configured.

## Validation

- Production-copy PostgreSQL migration rehearsal and model-column check passed.
- API smoke: 120 GET requests across 12 existing owners passed on the isolated clone.
- Chromium checked dashboard, clients, finance, dishes, orders and profile against the clone: no page exceptions or login redirects.
- Frontend and desktop production builds passed; 19 desktop payment tests passed.
- Full frontend suite initially: 2506 passed, 50 failed; comparison against clean 371098ad reproduced 42 failures and all 7 unhandled errors. The 8 additional failures were outdated expectations for requested UI/financial/QR behavior; their 73-test group passes after updating assertions. Known baseline failures are not represented as a green full suite.
- Focused backend coverage includes master login, kitchen login/refresh, branch login, payments including VIP, customer debt, printing, two-printer routing, purchase payment mode and stock cancellation. Tests for the merged support/kitchen refresh contract were added.

## Deployment and rollback

Server backup: /home/ubuntu/marjon-backups/release-20261119-server-sync. It contains the pre-release PostgreSQL dump, source/static/config archive and container inspection. Old backend image: marjon-backend:rollback-20261119-sync.

The obsolete marjon-offline test stack was stopped and removed; its database dump, directory and inactive recovery volumes are retained separately. Release rehearsal uses another isolated network and database, never the live database.

Database changes are additive. If rolling the backend back, run the old image with uvicorn directly (skip its old alembic startup, which cannot resolve the new revision). Do not restore a stale database dump over new customer activity. Publish hashed assets before entry HTML and retain existing asset files for open browser sessions.
