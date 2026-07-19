"""
utils/auth_utils.py
----------------------
Framework-agnostic auth helpers, kept separate from routes/auth_routes.py
the same way validators.py and pnl.py are kept separate from trade_routes.py.

Contains:
  - password hashing / verification (Werkzeug)
  - JWT issuing / decoding (PyJWT)
  - a @token_required decorator for protecting routes with a Bearer token
"""

from functools import wraps
from datetime import datetime, timedelta, timezone

import jwt
from flask import request, jsonify, current_app
from werkzeug.security import generate_password_hash, check_password_hash

from database.db import SessionLocal
from models.user import User


# ── Password hashing ──────────────────────────────────────────────────────

def hash_password(plain_password):
    """Hash a plaintext password using Werkzeug's PBKDF2-based hasher."""
    return generate_password_hash(plain_password)


def verify_password(password_hash, plain_password):
    """Check a plaintext password against a stored Werkzeug hash."""
    return check_password_hash(password_hash, plain_password)


# ── JWT issuing / decoding ────────────────────────────────────────────────

def generate_token(user_id):
    """
    Issue a signed JWT for the given user id.
    Expiration is read from Config.JWT_EXP_HOURS (default 24h).
    """
    exp_hours = current_app.config.get("JWT_EXP_HOURS", 24)
    payload = {
        "sub": str(user_id),
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=exp_hours),
    }
    secret = current_app.config["JWT_SECRET_KEY"]
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_token(token):
    """
    Decode and validate a JWT.

    Returns:
        (user_id: int | None, error_message: str | None)
    """
    secret = current_app.config["JWT_SECRET_KEY"]
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        return int(payload["sub"]), None
    except jwt.ExpiredSignatureError:
        return None, "Token has expired"
    except (jwt.InvalidTokenError, KeyError, ValueError):
        return None, "Invalid token"


# ── Route protection ─────────────────────────────────────────────────────

def get_token_from_request():
    """Extract the Bearer token from the Authorization header, if present."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header.split(" ", 1)[1].strip()
    return None


def token_required(f):
    """
    Decorator for routes that require a valid, logged-in user.

    On success, injects the authenticated User instance as the first
    positional argument to the wrapped view function (after `self`-style
    usage isn't relevant here since these are plain function views).

    Usage:
        @auth_bp.route("/me", methods=["GET"])
        @token_required
        def me(current_user):
            return jsonify(current_user.to_dict())
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        token = get_token_from_request()
        if not token:
            return jsonify({"status": "error", "message": "Missing authentication token"}), 401

        user_id, error = decode_token(token)
        if error:
            return jsonify({"status": "error", "message": error}), 401

        session = SessionLocal()
        try:
            user = session.get(User, user_id)
            if user is None or not user.is_active:
                return jsonify({"status": "error", "message": "User not found or inactive"}), 401
            return f(user, *args, **kwargs)
        finally:
            session.close()

    return decorated