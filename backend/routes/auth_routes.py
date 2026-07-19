"""
routes/auth_routes.py
------------------------
Authentication endpoints, under /api/auth.

Follows the same session-per-request pattern as routes/trade_routes.py:
each request opens a SQLAlchemy session, does its work, and closes it
in a `finally` block.

This blueprint only ever touches the `users` table (via models/user.py)
and never reads or writes `trades` in any way.
"""

from flask import Blueprint, request, jsonify

from database.db import SessionLocal
from models.user import User
from utils.auth_utils import (
    hash_password,
    verify_password,
    generate_token,
    token_required,
)

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@auth_bp.route("/register", methods=["POST"])
def register():
    """
    Create a new user account.

    Body:
        {
          "username": "trader_mike",
          "email": "mike@example.com",
          "password": "SomeStrongPassword123"
        }

    The password is hashed with Werkzeug before being stored — the
    plaintext password is never persisted or logged. Returns a JWT so
    the frontend can log the user straight in after registering.
    """
    data = request.get_json(silent=True) or {}

    username = (data.get("username") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not username or not email or not password:
        return jsonify({
            "status": "error",
            "message": "username, email, and password are all required",
        }), 400

    if len(password) < 8:
        return jsonify({
            "status": "error",
            "message": "Password must be at least 8 characters long",
        }), 400

    session = SessionLocal()
    try:
        existing = (
            session.query(User)
            .filter((User.username == username) | (User.email == email))
            .first()
        )
        if existing is not None:
            field = "username" if existing.username == username else "email"
            return jsonify({
                "status": "error",
                "message": f"An account with that {field} already exists",
            }), 409

        user = User(
            username=username,
            email=email,
            password_hash=hash_password(password),
        )
        session.add(user)
        session.commit()
        session.refresh(user)

        token = generate_token(user.id)
        return jsonify({
            "status": "success",
            "data": {"user": user.to_dict(), "token": token},
        }), 201
    except Exception as e:
        session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        session.close()


@auth_bp.route("/login", methods=["POST"])
def login():
    """
    Authenticate a user by username-or-email + password.

    Body:
        {
          "identifier": "trader_mike",   // username OR email
          "password": "SomeStrongPassword123"
        }

    Returns a JWT on success. "Remember Me" is handled entirely on the
    frontend (which token storage / expiry to honor); the token itself
    is identical either way.
    """
    data = request.get_json(silent=True) or {}

    identifier = (data.get("identifier") or "").strip()
    password = data.get("password") or ""

    if not identifier or not password:
        return jsonify({
            "status": "error",
            "message": "identifier and password are required",
        }), 400

    session = SessionLocal()
    try:
        user = (
            session.query(User)
            .filter((User.username == identifier) | (User.email == identifier.lower()))
            .first()
        )

        if user is None or not verify_password(user.password_hash, password):
            return jsonify({"status": "error", "message": "Invalid credentials"}), 401

        if not user.is_active:
            return jsonify({"status": "error", "message": "Account is disabled"}), 403

        token = generate_token(user.id)
        return jsonify({
            "status": "success",
            "data": {"user": user.to_dict(), "token": token},
        }), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        session.close()


@auth_bp.route("/me", methods=["GET"])
@token_required
def me(current_user):
    """
    Return the currently authenticated user, resolved from the Bearer
    token. Used by the frontend on page load/refresh to restore the
    session without asking the user to log in again.
    """
    return jsonify({"status": "success", "data": current_user.to_dict()}), 200


@auth_bp.route("/logout", methods=["POST"])
@token_required
def logout(current_user):
    """
    Logout endpoint.

    JWTs are stateless, so there is no server-side session to destroy —
    the actual "logging out" is the frontend discarding its stored
    token. This endpoint exists for a clean REST contract (and as a
    natural place to add server-side token revocation/blacklisting
    later, if ever needed) and simply confirms the token was valid.
    """
    return jsonify({"status": "success", "message": "Logged out"}), 200