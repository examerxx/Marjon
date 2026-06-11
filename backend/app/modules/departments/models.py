from __future__ import annotations
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column
from app.shared.base_model import TimeStampedModel


class Department(TimeStampedModel):
    __tablename__ = "adm_departments"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str | None] = mapped_column(String(64))
