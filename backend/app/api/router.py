from fastapi import APIRouter

from app.api.v1 import admin, auth, leave_requests, reference, team

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(reference.router)
api_router.include_router(leave_requests.router)
api_router.include_router(team.router)
api_router.include_router(admin.router)
