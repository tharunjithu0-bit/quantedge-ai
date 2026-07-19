"""
routes/db_routes.py
---------------------
Routes for verifying database connectivity and initializing tables.
No CRUD queries here — just connection checks and schema setup.
"""

from flask import Blueprint, jsonify

from database.db import test_connection, init_db
import models  # noqa: F401 — import registers all models on Base.metadata

db_bp = Blueprint("db", __name__)


@db_bp.route("/db-test", methods=["GET"])
def db_test():
    """Attempt to connect to MySQL and report the result."""
    success, error = test_connection()

    if success:
        return jsonify({"status": "connected"}), 200

    return jsonify({"status": "error", "message": error}), 500


@db_bp.route("/create-db", methods=["GET"])
def create_db():
    """
    Create any tables registered on Base.metadata (currently just
    `trades`) if they don't already exist. Safe to call more than once.
    """
    success, error = init_db()

    if success:
        return jsonify({"status": "success", "message": "Database tables created"}), 200

    return jsonify({"status": "error", "message": error}), 500
