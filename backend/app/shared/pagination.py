from __future__ import annotations
from typing import Generic, TypeVar, List
from pydantic import BaseModel

T = TypeVar("T")


class PageParams(BaseModel):
    page: int = 1
    size: int = 20

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.size


class Page(BaseModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    size: int
    pages: int

    @classmethod
    def create(cls, items: list, total: int, params: PageParams) -> "Page":
        pages = max(1, (total + params.size - 1) // params.size)
        return cls(items=items, total=total, page=params.page, size=params.size, pages=pages)
