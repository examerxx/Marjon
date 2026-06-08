from __future__ import annotations
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from app.modules.crm.models import Customer, CustomerNote
from app.modules.crm.repository import CustomerRepository, CustomerNoteRepository
from app.modules.crm.schemas import CustomerCreate, CustomerUpdate, NoteCreate
from app.shared.exceptions import NotFoundError, ConflictError


class CustomerService:
    def __init__(self, db: AsyncSession):
        self.repo = CustomerRepository(db)
        self.note_repo = CustomerNoteRepository(db)

    async def create(self, company_id: UUID, data: CustomerCreate) -> Customer:
        if await self.repo.get_by_phone(company_id, data.phone):
            raise ConflictError("Phone already registered")
        return await self.repo.save(Customer(company_id=company_id, **data.model_dump()))

    async def get(self, company_id: UUID, customer_id: UUID) -> Customer:
        c = await self.repo.get_by_id(customer_id, company_id)
        if not c:
            raise NotFoundError("Customer not found")
        return c

    async def list(self, company_id: UUID) -> list[Customer]:
        return await self.repo.get_all(company_id)

    async def search(self, company_id: UUID, q: str) -> list[Customer]:
        return await self.repo.search(company_id, q)

    async def update(self, company_id: UUID, customer_id: UUID, data: CustomerUpdate) -> Customer:
        c = await self.get(company_id, customer_id)
        for field, value in data.model_dump(exclude_none=True).items():
            setattr(c, field, value)
        return await self.repo.save(c)

    async def add_note(self, company_id: UUID, customer_id: UUID, author_id: UUID, data: NoteCreate) -> CustomerNote:
        await self.get(company_id, customer_id)
        note = CustomerNote(customer_id=customer_id, author_id=author_id, body=data.body)
        return await self.note_repo.save(note)
