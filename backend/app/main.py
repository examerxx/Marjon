from __future__ import annotations
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi import _rate_limit_exceeded_handler

from app.config import settings
from app.middleware.tenant_middleware import TenantMiddleware
from app.infrastructure.database.session import AsyncSessionLocal
from app.shared.error_handlers import register_error_handlers
from app.shared.rate_limit import limiter

# ── Register all models with SQLAlchemy metadata ────────────────────────────
import app.modules.companies.models       # noqa: F401
import app.modules.auth.models            # noqa: F401
import app.modules.rbac.models            # noqa: F401
import app.modules.inventory.models       # noqa: F401
import app.modules.crm.models             # noqa: F401
import app.modules.pos.models             # noqa: F401
import app.modules.payments.models        # noqa: F401
import app.modules.kitchen.models         # noqa: F401
import app.modules.loyalty.models         # noqa: F401
import app.modules.delivery.models        # noqa: F401
import app.modules.hr.models              # noqa: F401
import app.modules.notifications.models   # noqa: F401
import app.modules.audit.models           # noqa: F401
import app.modules.fiscal.models          # noqa: F401
import app.modules.subscriptions.models   # noqa: F401
import app.modules.printers.models        # noqa: F401
import app.modules.halls.models              # noqa: F401
import app.modules.inventory.warehouse_models  # noqa: F401
import app.modules.inventory.semi_product_models  # noqa: F401
import app.modules.kafe_compat.models     # noqa: F401
# Главная админка (HQ admin panel)
import app.modules.handbook.models        # noqa: F401
import app.modules.organizations.models   # noqa: F401
import app.modules.departments.models     # noqa: F401
import app.modules.marketing.models       # noqa: F401
import app.modules.nomenclature.models    # noqa: F401
import app.modules.storage.models         # noqa: F401
import app.modules.finance.models         # noqa: F401
import app.modules.field_service.models   # noqa: F401
import app.modules.tasks.models           # noqa: F401
import app.modules.admin_settings.models  # noqa: F401

# ── Routers ─────────────────────────────────────────────────────────────────
from app.modules.auth.router          import router as auth_router
from app.modules.companies.router     import router as companies_router
from app.modules.rbac.router          import router as rbac_router
from app.modules.inventory.router     import router as inventory_router
from app.modules.pos.router           import router as pos_router
from app.modules.payments.router          import router as payments_router
from app.modules.payments.webhooks        import router as payment_webhooks_router
from app.modules.payments.internal_router import router as payments_internal_router
from app.modules.kitchen.router       import router as kitchen_router
from app.modules.kitchen.websocket    import kitchen_ws_endpoint
from app.modules.crm.router           import router as crm_router
from app.modules.loyalty.router       import router as loyalty_router
from app.modules.delivery.router      import router as delivery_router
from app.modules.hr.router            import router as hr_router
from app.modules.analytics.router     import router as analytics_router
from app.modules.notifications.router import router as notifications_router
from app.modules.audit.router         import router as audit_router
from app.modules.fiscal.router        import router as fiscal_router
from app.modules.subscriptions.router import router as subscriptions_router
from app.modules.printers.router      import router as printers_router
from app.modules.halls.router                  import router as halls_router
from app.modules.inventory.warehouse_router    import router as warehouse_router
from app.modules.inventory.semi_product_router import router as semi_product_router
from app.modules.kafe_compat.router   import router as kafe_compat_router
# Главная админка (HQ admin panel)
from app.modules.handbook.router       import router as handbook_router
from app.modules.organizations.router  import router as organizations_router
from app.modules.departments.router    import router as departments_router
from app.modules.marketing.router      import router as marketing_router
from app.modules.nomenclature.router   import router as nomenclature_router
from app.modules.storage.router        import router as storage_router
from app.modules.finance.router        import router as finance_router, hq_router as finance_hq_router
from app.modules.field_service.router  import router as field_service_router
from app.modules.tasks.router          import router as tasks_router
from app.modules.ratings.router        import router as ratings_router
from app.modules.admin_settings.router import router as admin_settings_router
from app.modules.admin_reports.router  import router as admin_reports_router, admin_reports_router as hq_reports_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Seed RBAC permissions on startup
    from app.modules.rbac.permissions import seed_permissions, backfill_role_permissions
    async with AsyncSessionLocal() as db:
        try:
            count = await seed_permissions(db)
            if count:
                logger.info("Seeded %d new RBAC permissions", count)
        except Exception as e:
            logger.warning("Could not seed permissions (table may not exist yet): %s", e)
        try:
            # BE-05: attach default permissions to roles created before this
            # feature existed (idempotent — only adds missing RolePermission
            # links, safe to run on every boot).
            synced = await backfill_role_permissions(db)
            if synced:
                logger.info("Backfilled %d RBAC role-permission links", synced)
        except Exception as e:
            logger.warning("Could not backfill role permissions: %s", e)
    yield


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    debug=settings.debug,
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
register_error_handlers(app)  # BE-21: unified error envelope
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(TenantMiddleware)

API = "/api/v1"
routers = [
    auth_router, companies_router, rbac_router,
    inventory_router, pos_router, payments_router, payments_internal_router,
    kitchen_router, crm_router, loyalty_router,
    delivery_router, hr_router, analytics_router,
    notifications_router, audit_router,
    fiscal_router, subscriptions_router, printers_router,
    halls_router, warehouse_router, semi_product_router,
    # Главная админка
    handbook_router, organizations_router, departments_router,
    marketing_router, nomenclature_router, storage_router,
    finance_router, finance_hq_router, field_service_router, tasks_router,
    ratings_router, admin_settings_router, admin_reports_router,
    hq_reports_router,
]

for router in routers:
    app.include_router(router, prefix=API)

# kafe_compat: /settings/*, /billing/*, /support/*, /reports/*, /crm/counterparties
app.include_router(kafe_compat_router, prefix=API)

# Webhooks платёжных провайдеров (без JWT)
app.include_router(payment_webhooks_router, prefix=API)

# WebSocket для кухни
app.add_api_websocket_route("/ws/kitchen", kitchen_ws_endpoint)

@app.get("/health", tags=["system"])
async def health():
    return {"status": "ok", "version": "1.0.1"}
