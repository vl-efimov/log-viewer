from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.schemas.user import UserCreate, UserOut
from app.services.user_service import create_user, get_user_by_email
from app.core.database import get_db

router = APIRouter(prefix="/api", tags=["auth"])


@router.post("/register", response_model=UserOut)
async def register(user_create: UserCreate, db: AsyncSession = Depends(get_db)):
    existing_user = await get_user_by_email(db, user_create.email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    user = await create_user(db, user_create)
    return user
