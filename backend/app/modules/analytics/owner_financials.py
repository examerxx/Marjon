"""OWNER's agreed metric: confirmed completed-order income minus frozen item COGS.

Read-only. Finance categories/transactions remain independent and are never added
to these payments. Unknown historical costs are NULL, not fabricated zeroes.
"""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_FLOOR

from sqlalchemy import case, func, or_, select

from app.modules.analytics.service import AnalyticsService
from app.modules.analytics.owner_period import owner_period_bounds
from app.modules.companies.models import Branch
from app.modules.inventory.models import Category, Product
from app.modules.payments.models import Payment
from app.modules.pos.models import Order, OrderItem
from app.shared.exceptions import ValidationError

ZERO = Decimal("0")
BASIS = "completed_income_minus_snapshot_cogs"


def allocate_money(total, weights):
    """Largest-remainder cents; stable input order breaks ties, no lost cents."""
    if not weights:
        return []
    weights = [max(ZERO, w) for w in weights]
    if not sum(weights):
        weights = [Decimal(1)] * len(weights)
    cents = int(total.quantize(Decimal("0.01")) * 100)
    exact = [abs(cents) * w / sum(weights) for w in weights]
    whole = [int(v.to_integral_value(rounding=ROUND_FLOOR)) for v in exact]
    for i in sorted(range(len(weights)), key=lambda i: (-(exact[i] - whole[i]), i))[:abs(cents) - sum(whole)]:
        whole[i] += 1
    return [Decimal(v) / 100 * (-1 if cents < 0 else 1) for v in whole]


async def owner_financials(db, company_id, date_from: date, date_to: date, *, web_timezone: str | None = None,
                           time_from: str | None = None, time_to: str | None = None):
    if date_from > date_to or (date_to - date_from).days > 3660:
        raise ValidationError("Invalid report period (maximum 3661 days)")
    if web_timezone:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(web_timezone)
    else:
        tz = await AnalyticsService(db)._company_tz(company_id)
    start, end = owner_period_bounds(date_from, date_to, tz, time_from, time_to)
    # One row per order BEFORE joining positions: split payments do not multiply COGS.
    # VIP-часть (complimentary) денег не приносит, но закрывает счёт: заказ,
    # закрытый «частично деньгами + остаток VIP», тоже попадает в приход — в
    # сумме только фактически полученные деньги.
    paid = (select(Payment.order_id,
                   func.coalesce(func.sum(case((Payment.status == "completed", Payment.amount), else_=0)), 0).label("income"),
                   func.sum(case((Payment.status == "complimentary", 1), else_=0)).label("vip_count"),
                   func.max(Payment.updated_at).label("confirmed_at"))
            .where(Payment.company_id == company_id, Payment.status.in_(("completed", "complimentary")))
            .group_by(Payment.order_id).subquery())
    orders = (await db.execute(
        select(Order.id, Order.order_number, Order.created_at, Order.table_number,
               Order.branch_id, Order.table_id, Order.hall_name_snapshot, Branch.name.label("branch_name"),
               Order.order_type, Order.status, Order.total_amount, Order.service_fee, paid.c.income, paid.c.confirmed_at)
        .join(paid, paid.c.order_id == Order.id)
        .outerjoin(Branch, (Branch.id == Order.branch_id) & (Branch.company_id == company_id))
        .where(Order.company_id == company_id, Order.status == "completed",
               Order.total_amount > 0, paid.c.income > 0,
               or_(paid.c.income >= Order.total_amount, paid.c.vip_count > 0),
               paid.c.confirmed_at >= start, paid.c.confirmed_at < end)
        # The displayed timestamp, report period and chart buckets all use
        # the last confirmed payment, not when the order was first created.
        .order_by(paid.c.confirmed_at.desc(), Order.id)
    )).all()
    ids = [row.id for row in orders]
    costs = {order_id: {"amount": ZERO, "missing": 0, "items": 0} for order_id in ids}
    order_items = {order_id: [] for order_id in ids}
    if ids:
        items = (await db.execute(select(OrderItem, Category.name.label("category_name"))
            .outerjoin(Product, (Product.id == OrderItem.product_id) & (Product.company_id == company_id))
            .outerjoin(Category, (Category.id == Product.category_id) & (Category.company_id == company_id))
            .where(
            OrderItem.order_id.in_(ids), OrderItem.status != "cancelled", OrderItem.quantity > 0,
        ).order_by(OrderItem.created_at, OrderItem.id))).all()
        for item, category_name in items:
            order_items[item.order_id].append((item, category_name))
            cost = costs[item.order_id]
            cost["items"] += 1
            if item.cost_price_snapshot is None:
                cost["missing"] += 1
            else:
                cost["amount"] += Decimal(str(item.cost_price_snapshot)) * Decimal(str(item.quantity))
    hourly = date_from == date_to
    buckets = {}
    for index in range(24 if hourly else (date_to - date_from).days + 1):
        day = date_from if hourly else date_from + timedelta(days=index)
        key = index if hourly else day
        buckets[key] = {"date": day.isoformat(), "income": ZERO, "cost": ZERO, "orders_count": 0, "missing": 0,
                        **({"chart_label": f"{index:02d}:00"} if hourly else {})}
    income = ZERO
    cogs = ZERO
    missing = 0
    products = {}
    for order in orders:
        stamp = order.confirmed_at
        if stamp.tzinfo is None:  # SQLite stores UTC without tz information.
            stamp = stamp.replace(tzinfo=timezone.utc)
        local = stamp.astimezone(tz)
        bucket = buckets[local.hour if hourly else local.date()]
        cost = costs[order.id]
        cost["amount"] = cost["amount"].quantize(Decimal("0.01"))
        unknown = cost["missing"] + (1 if cost["items"] == 0 else 0)
        amount = Decimal(str(order.income))
        positions = order_items[order.id]
        if positions:
            weights = [max(ZERO, Decimal(str(item.total))) for item, _ in positions]
            if not sum(weights):
                weights = [Decimal(str(item.quantity)) for item, _ in positions]
            incomes = allocate_money(amount, weights)
            raw_costs = [ZERO if item.cost_price_snapshot is None else
                         Decimal(str(item.cost_price_snapshot)) * Decimal(str(item.quantity))
                         for item, _ in positions]
            # Allocate rounded order COGS too, so detail/footer/chart agree to a cent.
            item_costs = allocate_money(cost["amount"], raw_costs)
            for index, (item, category_name) in enumerate(positions):
                key = str(item.product_id)
                row = products.setdefault(key, {"product_id": key, "name": item.name,
                    "category": category_name or "Без категории", "quantity": ZERO,
                    "income": ZERO, "cost": ZERO, "missing": 0})
                row["quantity"] += Decimal(str(item.quantity))
                row["income"] += incomes[index]
                row["cost"] += item_costs[index]
                row["missing"] += int(item.cost_price_snapshot is None)
        else:
            # Legacy broken orders still reconcile; never silently drop their income.
            row = products.setdefault("unallocated", {"product_id": "unallocated",
                "name": "Заказы без сохранённых позиций", "category": "Нет данных",
                "quantity": ZERO, "income": ZERO, "cost": ZERO, "missing": 1})
            row["income"] += amount
        income += amount
        cogs += cost["amount"]
        missing += unknown
        bucket["income"] += amount
        bucket["cost"] += cost["amount"]
        bucket["missing"] += unknown
        bucket["orders_count"] += 1
    methods = []
    if ids:
        methods = [{"method": row.method, "amount": str(row.amount)} for row in (await db.execute(
            select(Payment.method, func.sum(Payment.amount).label("amount"))
            .where(Payment.company_id == company_id, Payment.order_id.in_(ids), Payment.status == "completed")
            .group_by(Payment.method).order_by(Payment.method)
        )).all()]
    active = await db.scalar(select(func.count(Order.id)).where(
        Order.company_id == company_id, Order.status.in_(["new", "accepted", "cooking", "ready"]),
    ))
    money = lambda amount: str(amount.quantize(Decimal("0.01")))
    # Same eligible orders and confirmed payment sums as the overall average.
    # Distinct branches/halls/tables must not collapse just because numbers match.
    places = {}
    multiple_branches = len({order.branch_id for order in orders}) > 1
    for order in orders:
        if order.table_number:
            identity = ("table", str(order.table_id)) if order.table_id else (
                "legacy-table", order.hall_name_snapshot, order.table_number)
            label = f"Стол {order.table_number}"
            if order.hall_name_snapshot:
                label = f"{order.hall_name_snapshot}, {label}"
        else:
            identity = ("channel", order.order_type)
            label = {"takeaway": "С собой", "delivery": "Доставка", "dine_in": "В зале"}.get(order.order_type, "Без места")
        key = (str(order.branch_id), identity)
        if multiple_branches:
            label = f"{order.branch_name or 'Филиал'} · {label}"
        place = places.setdefault(key, {"place": label, "orders_count": 0, "income": ZERO})
        place["orders_count"] += 1
        place["income"] += Decimal(str(order.income))
    average_check_rows = [{"id": str(index), "place": place["place"], "orders_count": place["orders_count"],
        "income": money(place["income"]), "avg_check": money(place["income"] / place["orders_count"])}
        for index, place in enumerate(sorted(places.values(), key=lambda place: (place["place"], -place["income"])))]
    sales = [{"date": b["date"], "orders_count": b["orders_count"],
              "revenue": None if b["missing"] else money(b["income"] - b["cost"]),
              "income": money(b["income"]), "cogs": None if b["missing"] else money(b["cost"]),
              "avg_check": money(b["income"] / b["orders_count"]) if b["orders_count"] else "0.00",
              **({"chart_label": b["chart_label"]} if hourly else {})} for b in buckets.values()]
    return {"metric_basis": BASIS, "date_from": date_from.isoformat(), "date_to": date_to.isoformat(),
            "income_total": money(income), "cogs_total": None if missing else money(cogs),
            "service_fee_total": money(sum((Decimal(str(order.service_fee or 0)) for order in orders), ZERO)),
            "today_revenue": None if missing else money(income - cogs),
            "today_orders": len(orders), "avg_check": money(income / len(orders)) if orders else "0.00",
            "active_orders": active or 0, "payment_methods": methods, "missing_cost_items": missing,
            "profit_unavailable_reason": "В оплаченных заказах не сохранена историческая себестоимость." if missing else None,
            "sales": sales,
            "average_check_rows": average_check_rows,
            "order_rows": [{"id": str(order.id), "number": order.order_number,
                "date_label": (order.confirmed_at.replace(tzinfo=timezone.utc) if order.confirmed_at.tzinfo is None
                               else order.confirmed_at).astimezone(tz).strftime("%d.%m %H:%M"),
                "place": f"Стол {order.table_number}" if order.table_number else
                         {"takeaway": "С собой", "delivery": "Доставка", "dine_in": "В зале"}.get(order.order_type, "—"),
                "amount": money(Decimal(str(order.total_amount))), "status": order.status} for order in orders],
            "orders_total": money(sum((Decimal(str(order.total_amount)) for order in orders), ZERO)),
            "product_rows": [{"product_id": row["product_id"], "name": row["name"],
                "category": row["category"], "quantity": str(row["quantity"]),
                "income": money(row["income"]), "cogs": None if row["missing"] else money(row["cost"]),
                "revenue": None if row["missing"] else money(row["income"] - row["cost"])}
                for row in sorted(products.values(), key=lambda row: (-row["income"], row["product_id"]))]}
