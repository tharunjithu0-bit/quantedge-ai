"""
routes/main_routes.py
----------------------
General-purpose routes that don't belong to a specific resource yet
(health checks, root endpoint, etc.).
"""

from flask import Blueprint, jsonify

main_bp = Blueprint("main", __name__)


@main_bp.route("/", methods=["GET"])
def index():
    """Basic health-check endpoint to confirm the backend is running."""
    return jsonify({"message": "QuantEdge AI Backend Running"}), 200
