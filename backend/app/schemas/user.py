from pydantic import BaseModel, EmailStr
from typing import Optional


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: Optional[str] = None


class UserOut(BaseModel):
    id: str
    email: EmailStr
    name: Optional[str] = None

    class Config:
        orm_mode = True
