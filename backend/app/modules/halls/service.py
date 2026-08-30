from __future__ import annotations
from datetime import datetime, timezone
from uuid import UUID
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from app.modules.companies.models import Branch
from app.modules.finance.models import PaymentType
from app.modules.finance.ownership import FinanceScope, require_finance_reference
from app.modules.halls.models import Hall, Table
from app.modules.halls.schemas import HallCreate, HallUpdate, TableCreate, TableUpdate
from app.shared.exceptions import ConflictError, NotFoundError
from app.shared.tenant_scope import require_company_resource


class HallService:
    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def _tables_loader(include_inactive_tables: bool):
        """Eager-load nested tables in one extra query for the whole result set
        (selectinload, so no N+1). The flag controls VISIBILITY only — never
        uniqueness (Phase 5C-3) and never lifecycle rules."""
        if include_inactive_tables:
            return selectinload(Hall.tables)
        return selectinload(Hall.tables.and_(Table.is_active.is_(True)))

    async def list(
        self,
        company_id: UUID,
        branch_id: UUID | None = None,
        *,
        include_inactive: bool = False,
    ) -> list[Hall]:
        # Default stays ACTIVE-ONLY for backward compatibility: soft-deleted
        # halls drop out of the places directory and their tables are likewise
        # loaded active-only. Phase 5C-4: `include_inactive=True` exposes the
        # archive (halls AND their nested tables) for the Settings management
        # view. Tenant/branch scoping is untouched — the flag never widens
        # ownership. Historical orders keep their table_id regardless.
        #
        # Phase 5C-6A: deterministic branch-scoped ordering.
        #  - branch-scoped list  → ORDER BY sort_order, then id (stable tie).
        #  - company-wide list   → there is NO single global drag order, so
        #    halls are grouped by their branch in the canonical branch order
        #    (Branch.created_at, Branch.id — Branch has no explicit sort field
        #    and this task does not add one), then by sort_order within each
        #    branch. include_inactive keeps the exact same order; archived
        #    halls stay in their stored position, they are not sorted apart.
        q = (
            select(Hall)
            .options(self._tables_loader(include_inactive))
            .where(Hall.company_id == company_id)
            # Phase 5C-6D: DELETED (deleted_at set) halls never appear in the
            # Settings directory. include_inactive toggles is_active ONLY; it
            # never resurrects a deleted hall.
            .where(Hall.deleted_at.is_(None))
        )
        if not include_inactive:
            q = q.where(Hall.is_active.is_(True))
        if branch_id:
            q = q.where(Hall.branch_id == branch_id).order_by(Hall.sort_order, Hall.id)
        else:
            q = (
                q.join(Branch, Branch.id == Hall.branch_id)
                .order_by(Branch.created_at, Branch.id, Hall.sort_order, Hall.id)
            )
        result = await self.db.execute(q)
        return list(result.scalars().all())

    async def get(
        self,
        company_id: UUID,
        hall_id: UUID,
        *,
        include_inactive_tables: bool = False,
        refresh_tables: bool = False,
    ) -> Hall:
        # Two distinct states, two distinct answers here:
        #  * INACTIVE (is_active=false) — still addressable by id, unchanged
        #    pre-5C-4 behaviour. `include_inactive_tables` only widens the
        #    NESTED tables collection, it does not gate the hall itself.
        #  * DELETED (deleted_at set, Phase 5C-6D) — NOT addressable. This is
        #    the management/operational resolver, so every path routed through
        #    it 404s: the hall cannot be read, edited, given tables, or
        #    reordered.
        # Scope note: this resolver does NOT govern historical reporting. The
        # Tables report resolves hall_id via require_company_resource, which is
        # deliberately deleted-agnostic, so past business data stays queryable
        # by id. See admin_reports.AdminReportService.tables_report.
        query = (
            select(Hall).options(self._tables_loader(include_inactive_tables))
            .where(
                Hall.id == hall_id,
                Hall.company_id == company_id,
                Hall.deleted_at.is_(None),
            )
        )
        if refresh_tables:
            # SQLAlchemy leaves an already-loaded relationship untouched on a
            # plain re-select, so a hall whose tables were just mutated would
            # serialize the stale collection. Post-write reads must re-populate
            # it or the response could contradict the active-only contract.
            query = query.execution_options(populate_existing=True)
        hall = (await self.db.execute(query)).scalar_one_or_none()
        if not hall:
            raise NotFoundError("Hall not found")
        return hall

    async def _resolve_branch(self, company_id: UUID, branch_id: UUID | None) -> UUID:
        """BE-14 / Phase 5C-1: resolve the branch a place attaches to.

        Explicit branch_id is validated for tenant ownership (+ active). When
        omitted the sole active branch is used; zero or many active branches are
        a deliberate configuration conflict rather than a silent first-branch
        pick, so the caller must onboard/choose."""
        if branch_id is not None:
            branch = await require_company_resource(
                self.db, Branch, branch_id, company_id, detail="Branch not found"
            )
            if branch.is_active is False:
                raise ConflictError("Филиал неактивен")
            return branch.id
        result = await self.db.execute(
            select(Branch).where(Branch.company_id == company_id, Branch.is_active.is_(True))
        )
        branches = list(result.scalars().all())
        if not branches:
            raise ConflictError("Не настроен филиал. Создайте филиал, чтобы добавить место.")
        if len(branches) > 1:
            raise ConflictError("Укажите филиал")
        return branches[0].id

    async def create(self, company_id: UUID, data: HallCreate) -> Hall:
        branch_id = await self._resolve_branch(company_id, data.branch_id)
        await require_finance_reference(
            self.db,
            PaymentType,
            data.payment_type_id,
            FinanceScope("company", company_id),
            allow_system=True,
            detail="PaymentType not found",
        )
        # Phase 5C-6A: a new hall is appended to the END of its branch ordering.
        sort_order = await self._next_sort_order(branch_id)
        hall = Hall(
            company_id=company_id, branch_id=branch_id,
            name=data.name, description=data.description,
            condition=data.condition, percent=data.percent,
            price_amount=data.price_amount,
            pricing_type=data.pricing_type, payment_type_id=data.payment_type_id,
            sort_order=sort_order,
        )
        self.db.add(hall)
        await self.db.commit()
        await self.db.refresh(hall)
        result = await self.db.execute(
            select(Hall).options(selectinload(Hall.tables)).where(
                Hall.id == hall.id, Hall.company_id == company_id
            )
        )
        return result.scalar_one()

    async def _next_sort_order(self, branch_id: UUID) -> int:
        """Next append position for `branch_id`, computed under a per-branch
        row lock so two concurrent hall creates get consecutive positions
        instead of colliding on the same max+1. The lock is on the parent
        branch row only — different branches never block each other and there
        is no global lock. On SQLite (tests) FOR UPDATE is a silent no-op,
        which is fine: those runs are single-connection."""
        await self.db.execute(
            select(Branch.id).where(Branch.id == branch_id).with_for_update()
        )
        current_max = (
            await self.db.execute(
                select(func.max(Hall.sort_order)).where(Hall.branch_id == branch_id)
            )
        ).scalar_one_or_none()
        return 0 if current_max is None else current_max + 1

    # Phase 5C-6A reorder. Complete-list contract: `hall_ids` must be exactly
    # the set of the branch's halls (active + inactive) with no duplicates. A
    # partial/duplicate/foreign/cross-branch list is rejected wholesale rather
    # than applied, so the stored order can never end up with gaps or dup
    # positions. Only sort_order is written.
    _REORDER_DUPLICATE_DETAIL = "Обнаружены повторяющиеся места в порядке."
    _REORDER_MISMATCH_DETAIL = (
        "Список мест должен точно соответствовать местам этого филиала."
    )

    async def reorder(
        self, company_id: UUID, branch_id: UUID, hall_ids: list[UUID]
    ) -> list[Hall]:
        # Branch must exist AND belong to the caller's company (404 otherwise) —
        # this is the first tenant/branch gate and rejects a foreign branch_id.
        await require_company_resource(
            self.db, Branch, branch_id, company_id, detail="Branch not found"
        )
        if len(hall_ids) != len(set(hall_ids)):
            raise ConflictError(self._REORDER_DUPLICATE_DETAIL)
        # Load the branch's COMPLETE hall set (active + inactive), tenant-scoped.
        # Phase 5C-6D: "complete" means all NON-DELETED halls — deleted halls are
        # invisible in Settings, so the frontend must NOT (and cannot) include
        # their ids, and they never participate in ordering.
        result = await self.db.execute(
            select(Hall).where(
                Hall.company_id == company_id,
                Hall.branch_id == branch_id,
                Hall.deleted_at.is_(None),
            )
        )
        halls = list(result.scalars().all())
        by_id = {hall.id: hall for hall in halls}
        # One equality check subsumes every rejection the contract requires:
        # a missing hall, an extra id, a hall from another branch, and a hall
        # of another tenant all make the requested set differ from this
        # branch's set. Nothing is mutated before this passes → atomic.
        if set(hall_ids) != set(by_id):
            raise ConflictError(self._REORDER_MISMATCH_DETAIL)
        # Assign a clean 0-based permutation in the requested order. Reorder
        # touches ONLY sort_order — branch_id, is_active, pricing, tables are
        # never read for write here, so an inactive hall stays inactive and an
        # active hall stays active.
        for position, hall_id in enumerate(hall_ids):
            by_id[hall_id].sort_order = position
        await self.db.commit()
        # Return canonical state read back from the DB, ordered — never just
        # echo the request. Settings shows archived halls, so include them.
        return await self.list(company_id, branch_id, include_inactive=True)

    # Phase 5C-2: only the structured pricing fields honour an EXPLICIT null so
    # the settings UI can clear "Доп. цена". Every other field keeps the
    # historical behaviour (explicit null ignored) to avoid a broad regression.
    _PRICING_CLEARABLE = ("price_amount", "pricing_type")

    async def update(self, company_id: UUID, hall_id: UUID, data: HallUpdate) -> Hall:
        # Active-only nested tables: that is both the response shape callers
        # already receive and exactly the set a deactivation cascade must flip.
        hall = await self.get(company_id, hall_id)
        if "payment_type_id" in data.model_fields_set:
            await require_finance_reference(
                self.db,
                PaymentType,
                data.payment_type_id,
                FinanceScope("company", company_id),
                allow_system=True,
                detail="PaymentType not found",
            )
        payload = data.model_dump(exclude_unset=True)
        # Phase 5C-4 lifecycle transitions. An archived hall stays freely
        # editable (name/pricing/...); only the is_active edges are gated.
        reactivating = payload.get("is_active") is True and not hall.is_active
        deactivating = payload.get("is_active") is False and hall.is_active
        if reactivating:
            # Phase 5C-1 invariant: a hall may only become operational under an
            # ACTIVE branch of its own company. Child tables are deliberately
            # NOT resurrected — see _deactivate_child_tables.
            await self._assert_branch_active(company_id, hall.branch_id)
        for field, value in payload.items():
            if value is None and field not in self._PRICING_CLEARABLE:
                continue
            setattr(hall, field, value)
        if deactivating:
            # Same cascade as DELETE, so "hall inactive + table active" is
            # unreachable through either deactivation route.
            self._deactivate_child_tables(hall)
        await self.db.commit()
        await self.db.refresh(hall)
        return await self.get(company_id, hall_id, refresh_tables=True)

    async def _assert_branch_active(self, company_id: UUID, branch_id: UUID) -> None:
        """A hall may only become operational under an active branch of its own
        company. Never creates or reactivates a branch as a side effect."""
        branch = await require_company_resource(
            self.db, Branch, branch_id, company_id, detail="Branch not found"
        )
        if branch.is_active is False:
            raise ConflictError("Филиал неактивен")

    @staticmethod
    def _deactivate_child_tables(hall: Hall) -> None:
        """Archive the hall's still-active tables (soft only).

        Reactivating the hall later does NOT resurrect them: some tables may
        have been deliberately inactive beforehand, no prior-state record
        exists, and guessing would destroy that distinction. Each table is
        re-enabled by hand instead. Numbers and Order.table_id are untouched.
        """
        for table in hall.tables:
            table.is_active = False

    async def delete(self, company_id: UUID, hall_id: UUID) -> None:
        # Phase 5C-6D: the user-facing Trash action ARCHIVES the hall — a state
        # distinct from is_active. Setting deleted_at removes it from the
        # Settings directory and all operational selection, while its Tables and
        # any historical Order.table_id references are preserved (never hard
        # deleted). Child tables are deactivated so nothing under a deleted hall
        # stays operationally selectable. is_active is left as-is: deleted_at is
        # the authority, and the status switch (is_active) never deletes.
        # Historical reporting stays intentionally reachable by explicit hall_id
        # (see AdminReportService.tables_report) — this archives the place, it
        # does not close its books.
        hall = await self.get(company_id, hall_id)
        hall.deleted_at = datetime.now(timezone.utc)
        self._deactivate_child_tables(hall)
        await self._compact_branch_order(company_id, hall.branch_id, exclude_id=hall.id)
        await self.db.commit()

    async def _compact_branch_order(
        self, company_id: UUID, branch_id: UUID, *, exclude_id: UUID
    ) -> None:
        """Canonically renumber the branch's remaining NON-DELETED halls to a
        contiguous 0..n-1 in their current order, so removing a hall never
        leaves an ordering gap. `exclude_id` is the just-archived hall (its
        deleted_at is set in the same uncommitted transaction, so it is skipped
        both by this query's filter and defensively by id)."""
        result = await self.db.execute(
            select(Hall)
            .where(
                Hall.company_id == company_id,
                Hall.branch_id == branch_id,
                Hall.deleted_at.is_(None),
                Hall.id != exclude_id,
            )
            .order_by(Hall.sort_order, Hall.id)
        )
        for position, remaining in enumerate(result.scalars().all()):
            remaining.sort_order = position

    async def list_tables(
        self, company_id: UUID, hall_id: UUID, *, include_inactive: bool = False
    ) -> list[Table]:
        # Default ACTIVE-ONLY (unchanged); include_inactive exposes the archive
        # for the Settings management view. Ownership is still proven by
        # resolving the hall inside the tenant first.
        hall = await self.get(company_id, hall_id)
        query = select(Table).where(Table.hall_id == hall.id)
        if not include_inactive:
            query = query.where(Table.is_active.is_(True))
        result = await self.db.execute(query.order_by(Table.number))
        return list(result.scalars().all())

    # Phase 5C-3: (hall_id, number) is unique among ACTIVE tables. The partial
    # unique index `uq_tables_hall_number_active` is the concurrency-safe final
    # authority; these helpers only turn it into a friendly domain 409.
    _TABLE_NUMBER_INDEX = "uq_tables_hall_number_active"
    _DUPLICATE_TABLE_DETAIL = "Стол с таким номером уже существует в этом месте"

    def _is_table_number_violation(self, exc: IntegrityError) -> bool:
        """True only for our named partial unique index — never swallow other
        integrity errors under the duplicate-table message."""
        original = getattr(exc, "orig", None)
        for candidate in (
            getattr(original, "constraint_name", None),
            getattr(getattr(original, "diag", None), "constraint_name", None),
        ):
            if candidate:
                return candidate == self._TABLE_NUMBER_INDEX
        return self._TABLE_NUMBER_INDEX in str(original or exc)

    async def _assert_table_number_free(
        self, hall_id: UUID, number: int | None, *, exclude_table_id: UUID | None = None
    ) -> None:
        if number is None:
            return
        query = select(Table.id).where(
            Table.hall_id == hall_id,
            Table.number == number,
            Table.is_active.is_(True),
        )
        if exclude_table_id is not None:
            query = query.where(Table.id != exclude_table_id)
        if (await self.db.execute(query.limit(1))).scalar_one_or_none() is not None:
            raise ConflictError(self._DUPLICATE_TABLE_DETAIL)

    async def _commit_table(self, table: Table) -> Table:
        try:
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            if self._is_table_number_violation(exc):
                raise ConflictError(self._DUPLICATE_TABLE_DETAIL) from exc
            raise
        await self.db.refresh(table)
        return table

    _INACTIVE_HALL_DETAIL = "Место неактивно — сначала активируйте место"

    async def create_table(self, company_id: UUID, hall_id: UUID, data: TableCreate) -> Table:
        # Phase 5C-4: a new table is an operational row, so the parent hall must
        # be active. Never silently activates the hall.
        hall = await self.get(company_id, hall_id)
        if not hall.is_active:
            raise ConflictError(self._INACTIVE_HALL_DETAIL)
        await self._assert_table_number_free(hall_id, data.number)
        table = Table(hall_id=hall_id, number=data.number, capacity=data.capacity)
        self.db.add(table)
        return await self._commit_table(table)

    async def update_table(self, company_id: UUID, hall_id: UUID, table_id: UUID, data: TableUpdate) -> Table:
        hall = await self.get(company_id, hall_id)
        result = await self.db.execute(
            select(Table).where(Table.id == table_id, Table.hall_id == hall_id)
        )
        table = result.scalar_one_or_none()
        if not table:
            raise NotFoundError("Table not found")
        payload = data.model_dump(exclude_none=True)
        # A row moving to a new number, or being re-activated, must not collide
        # with another ACTIVE table holding that number in the same hall.
        target_number = payload.get("number", table.number)
        will_be_active = payload.get("is_active", table.is_active)
        # Phase 5C-4: activation is the only transition gated on the hall, and
        # it is what keeps "hall inactive + table active" unreachable. Ordinary
        # metadata edits of an archived table stay allowed, so an archived hall
        # never becomes an administrative dead end.
        if will_be_active and not hall.is_active:
            raise ConflictError(self._INACTIVE_HALL_DETAIL)
        if will_be_active:
            await self._assert_table_number_free(
                hall_id, target_number, exclude_table_id=table.id
            )
        for field, value in payload.items():
            setattr(table, field, value)
        return await self._commit_table(table)

    async def delete_table(self, company_id: UUID, hall_id: UUID, table_id: UUID) -> None:
        await self.get(company_id, hall_id)
        result = await self.db.execute(
            select(Table).where(Table.id == table_id, Table.hall_id == hall_id)
        )
        table = result.scalar_one_or_none()
        if not table:
            raise NotFoundError("Table not found")
        # Soft-delete: a historical Order.table_id may point here. Deactivate rather
        # than physically remove so order history keeps its canonical seating link.
        table.is_active = False
        await self.db.commit()

    async def branch_tables(self, company_id: UUID, branch_id: UUID) -> list[Table]:
        """Get all active tables across all halls in a branch. Phase 5C-6D:
        deleted halls are excluded, so a deleted hall's seating is never offered
        to the POS/waiter picker."""
        result = await self.db.execute(
            select(Table)
            .join(Hall, Hall.id == Table.hall_id)
            .where(Hall.company_id == company_id, Hall.branch_id == branch_id,
                   Hall.deleted_at.is_(None),
                   Hall.is_active == True, Table.is_active == True)
            .order_by(Table.number)
        )
        return list(result.scalars().all())
