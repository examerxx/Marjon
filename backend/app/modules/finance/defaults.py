"""Stable identifiers for built-in finance dictionary entries."""
from uuid import UUID

VIP_PAYMENT_TYPE_ID = UUID("fef15000-0000-4000-8000-000000000003")
VIP_EXPENSE_CATEGORY_ID = UUID("fef15000-0000-4000-8000-000000000005")

DEFAULT_PAYMENT_IDS = frozenset(
    UUID(f"fef15000-0000-4000-8000-{index:012d}") for index in range(1, 5)
)
