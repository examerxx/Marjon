from __future__ import annotations
from app.shared.admin_crud import crud_router
from app.modules.departments import models, schemas

router = crud_router(
    prefix="/departments", tags=["departments"],
    model=models.Department,
    create_schema=schemas.DepartmentCreate,
    update_schema=schemas.DepartmentUpdate,
    response_schema=schemas.DepartmentResponse,
    search_fields=("name",),
    filter_fields=("type",),
    default_sort="name",
)
