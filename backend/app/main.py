from fastapi import FastAPI
from app.core.database import engine
from app.models.user import Base
from app.api.v1.auth import router as auth_router
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# TODO: Config CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


app.include_router(auth_router)


@app.get("/")
async def root():
    return {"message": "PWA Backend Running"}
