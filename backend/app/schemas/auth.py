from pydantic import EmailStr, Field

from app.schemas.common import APIModel, ORMModel
from app.schemas.user import UserOut


class LoginRequest(APIModel):
    email: EmailStr
    # Not the Password type: a login attempt with an odd password should get 401, not 422.
    password: str = Field(min_length=1, max_length=128)


class TokenResponse(ORMModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int = Field(description="Seconds until the token expires")
    user: UserOut
