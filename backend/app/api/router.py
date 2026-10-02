from fastapi import APIRouter

from app.api.v1 import auth, leave_requests, reference

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(reference.router)
api_router.include_router(leave_requests.router)
