from __future__ import annotations
from fastapi import HTTPException, status


class NotFoundError(HTTPException):
    def __init__(self, detail: str = "Resource not found"):
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


class ForbiddenError(HTTPException):
    def __init__(self, detail: str = "Access denied"):
        super().__init__(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


class ConflictError(HTTPException):
    def __init__(self, detail: str = "Resource already exists"):
        super().__init__(status_code=status.HTTP_409_CONFLICT, detail=detail)


class UnauthorizedError(HTTPException):
    def __init__(self, detail: str = "Not authenticated"):
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
            headers={"WWW-Authenticate": "Bearer"},
        )


class ValidationError(HTTPException):
    def __init__(self, detail: str = "Validation error"):
        super().__init__(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


class BranchSelectionRequiredError(HTTPException):
    """Логин верный, но у компании несколько филиалов: кухонному экрану нужен
    конкретный филиал. Клиент показывает выбор и повторяет вход с branch_id."""

    def __init__(
        self,
        branches: list[dict] | None = None,
        detail: str = "Выберите филиал",
    ):
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            detail={"message": detail, "branches": branches or []},
        )

