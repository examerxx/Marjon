from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from pydantic import BaseModel


class RatingRow(BaseModel):
    employee_id: UUID
    employee_fio: str
    tasks_total: int
    on_time: int
    late: int
    not_done: int
    on_time_points: int
    late_points: int
    not_done_points: int
    total_points: int
    completion_percent: Decimal
    penalty_sum: Decimal
    payable_amount: Decimal
