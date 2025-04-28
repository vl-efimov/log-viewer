from fastapi import FastAPI
from app import models
from app.database import engine

app = FastAPI()


@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)


@app.get("/")
async def root():
    return {"message": "PWA Backend Running"}
