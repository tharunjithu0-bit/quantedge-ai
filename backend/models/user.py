"""
models/user.py
-----------------
ORM model for an authenticated user. Stores credentials only —
password_hash is a Werkzeug-generated hash, never a plaintext password.

This model lives in its own table (`users`) and has no foreign-key
relationship to `trades`, so it can be added without touching the
existing trades table or its data in any way.
"""

from sqlalchemy import Column, Integer, String, DateTime, Boolean
from sqlalchemy.sql import func

from database.db import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)

    username = Column(String(50), unique=True, nullable=False, index=True)
    email = Column(String(120), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)

    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    def __repr__(self):
        return f"<User id={self.id} username={self.username}>"

    def to_dict(self):
        """
        Serialize the model into a JSON-friendly dict.
        password_hash is intentionally never included here — this is
        the shape returned by /api/auth/me and embedded in login/
        register responses.
        """
        return {
            "id": self.id,
            "username": self.username,
            "email": self.email,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }