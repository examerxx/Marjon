from fastapi import APIRouter, Depends
from auth import get_current_user
from schemas import UserResponse
import models

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserResponse)
def get_me(current_user: models.User = Depends(get_current_user)):
    return current_user
