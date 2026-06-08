from __future__ import annotations
from uuid import UUID
from app.shared.base_schema import BaseSchema, BaseResponseSchema


class RoleCreate(BaseSchema):
    name: str
    slug: str
    description: str | None = None


class RoleUpdate(BaseSchema):
    name: str | None = None
    description: str | None = None


class RoleResponse(BaseResponseSchema):
    company_id: UUID | None
    name: str
    slug: str
    is_system: bool
    description: str | None


class PermissionResponse(BaseResponseSchema):
    module: str
    action: str
    scope: str


class UserRoleAssign(BaseSchema):
    user_id: UUID
    role_id: UUID
    branch_id: UUID | None = None


class UserRoleResponse(BaseResponseSchema):
    user_id: UUID
    role_id: UUID
    branch_id: UUID | None
