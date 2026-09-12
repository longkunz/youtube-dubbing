from fastapi import HTTPException


def require_bearer(authorization: str | None, expected: str) -> None:
    if not expected:
        raise HTTPException(status_code=500, detail="BACKEND_API_KEY is not configured")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization[len("Bearer "):].strip()
    if token != expected:
        raise HTTPException(status_code=401, detail="Invalid bearer token")
