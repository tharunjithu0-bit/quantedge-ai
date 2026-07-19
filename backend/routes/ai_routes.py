"""
routes/ai_routes.py
---------------------
AI-powered coaching endpoint, backed by Google Gemini.

Gemini only interprets statistics the app has already computed on the
client (see AICoach.tsx's computeInsights()) — it never recalculates or
invents numbers. This mirrors the pattern used elsewhere in the app
(e.g. pnl/result in trade_routes.py) of keeping a single source of truth
for derived values.
"""

from flask import Blueprint, request, jsonify

from utils.gemini_coach import (
    generate_coaching_analysis,
    GeminiConfigError,
    GeminiRequestError,
)

ai_bp = Blueprint("ai", __name__, url_prefix="/api/ai")


@ai_bp.route("/analyze", methods=["POST"])
def analyze():
    """
    Body:
        {
          "insights": {
            ... computed metrics / patterns / recommendations / weekly
            review, as produced by computeInsights() on the frontend ...
          }
        }

    Response (success):
        {
          "status": "success",
          "data": {
            "overall_assessment": "...",
            "strengths": ["...", "...", "..."],
            "weaknesses": ["...", "...", "..."],
            "psychology": "...",
            "action_plan": ["...", "...", "..."],
            "summary": "..."
          }
        }

    Response (error):
        { "status": "error", "message": "..." }
    """
    body = request.get_json(silent=True)
    if not body or not isinstance(body.get("insights"), dict):
        return jsonify({
            "status": "error",
            "message": "Request body must include an 'insights' object.",
        }), 400

    insights = body["insights"]
    if not insights:
        return jsonify({
            "status": "error",
            "message": "'insights' is empty — nothing to analyze yet.",
        }), 400

    try:
        analysis = generate_coaching_analysis(insights)
    except GeminiConfigError as e:
        # Missing/misconfigured API key — a server setup problem, not the caller's fault.
        return jsonify({"status": "error", "message": str(e)}), 500
    except GeminiRequestError as e:
        # Upstream Gemini call failed or returned something unusable.
        return jsonify({"status": "error", "message": str(e)}), 502
    except Exception as e:
        return jsonify({"status": "error", "message": f"Unexpected error: {e}"}), 500

    return jsonify({"status": "success", "data": analysis}), 200