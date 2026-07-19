"""
routes/trade_routes.py
------------------------
RESTful CRUD endpoints for the Trade model, under /api/trades.

Each request opens a SQLAlchemy session, does its work, and closes
the session in a `finally` block — sessions are cheap to open/close
per-request and this avoids leaking connections.
"""

from flask import Blueprint, request, jsonify

from database.db import SessionLocal
from models.trade import Trade
from utils.validators import validate_trade_payload
from utils.pnl import calculate_pnl, determine_result
from utils.trade_import import process_trade_csv

trade_bp = Blueprint("trades", __name__, url_prefix="/api/trades")


@trade_bp.route("", methods=["POST"])
def create_trade():
    """
    Create a new trade journal entry.

    Required fields: asset, direction, entry, trade_date, lot_size
    Optional fields: exit, stop_loss, take_profit, setup_type, result, notes

    Body example:
        {
          "asset": "EUR/USD",
          "direction": "buy",
          "entry": 1.0925,
          "exit": 1.0980,
          "stop_loss": 1.0890,
          "take_profit": 1.1000,
          "lot_size": 0.5,
          "setup_type": "breakout",
          "result": "win",
          "trade_date": "2026-07-18",
          "notes": "Clean breakout above resistance."
        }

    P&L is never accepted from the client — it's always derived from
    entry/exit/direction/lot_size/asset via calculate_pnl() and stored
    on the trade. result is likewise never accepted from the client —
    it's always derived from pnl via determine_result(), so any
    "result" field in the request body is ignored/overwritten. This
    keeps pnl and result as a single, consistent source of truth
    regardless of how a trade is created. Risk:Reward (based on
    entry/stop_loss/take_profit) is unrelated to lot size and is
    computed client-side as before.
    """
    data = request.get_json(silent=True)
    cleaned, error = validate_trade_payload(data, partial=False)
    if error:
        return jsonify({"status": "error", "message": error}), 400

    cleaned["pnl"] = calculate_pnl(
        asset=cleaned["asset"],
        direction=cleaned["direction"],
        entry=cleaned["entry"],
        exit_price=cleaned.get("exit"),
        lot_size=cleaned["lot_size"],
    )
    cleaned["result"] = determine_result(cleaned["pnl"])

    session = SessionLocal()
    try:
        trade = Trade(**cleaned)
        session.add(trade)
        session.commit()
        session.refresh(trade)
        return jsonify({"status": "success", "data": trade.to_dict()}), 201
    except Exception as e:
        session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        session.close()


@trade_bp.route("", methods=["GET"])
def get_trades():
    """
    List all trades, most recent trade_date first.
    """
    session = SessionLocal()
    try:
        trades = session.query(Trade).order_by(Trade.trade_date.desc(), Trade.id.desc()).all()
        return jsonify({"status": "success", "data": [t.to_dict() for t in trades]}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        session.close()


@trade_bp.route("/import", methods=["POST"])
def import_trades():
    """
    Bulk import trades from a CSV file.

    Expects multipart/form-data with a 'file' field. All parsing and
    validation happens in process_trade_csv(), which runs every row
    through the same validate_trade_payload() -> calculate_pnl() ->
    determine_result() pipeline as create_trade() above, so a
    CSV-imported trade and a manually entered trade are computed
    identically. Any 'result' column in the CSV is ignored by that
    pipeline; result always comes from pnl.

    Valid rows are inserted in a single transaction: either every
    valid row is committed, or (on a DB error) none are and the whole
    batch is rolled back. Per-row validation errors are collected
    separately by process_trade_csv() and don't block rows that
    passed — those are reported back but never touch the database.
    """
    if "file" not in request.files:
        return jsonify({"status": "error", "message": "No file provided (expected form field 'file')"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"status": "error", "message": "No file selected"}), 400

    valid_trades, validation_errors = process_trade_csv(file.stream)

    session = SessionLocal()
    imported = 0
    try:
        for cleaned in valid_trades:
            session.add(Trade(**cleaned))
        session.commit()
        imported = len(valid_trades)
    except Exception as e:
        session.rollback()
        return jsonify({"status": "error", "message": f"Failed to save trades: {e}"}), 500
    finally:
        session.close()

    return jsonify({
        "status": "success",
        "imported": imported,
        "failed": len(validation_errors),
        "errors": validation_errors,
    }), 200


@trade_bp.route("/all", methods=["DELETE"])
def delete_all_trades():
    """
    Delete every trade in the database in a single transaction.

    Placed above the /<int:trade_id> routes (same reasoning as /import)
    so Flask matches the literal "/all" segment rather than trying to
    coerce it through the int converter.

    Returns the number of trades deleted so the frontend can show a
    confirmation message without needing a follow-up GET.
    """
    session = SessionLocal()
    try:
        deleted_count = session.query(Trade).delete()
        session.commit()
        return jsonify({
            "status": "success",
            "message": f"Deleted {deleted_count} trade(s)",
            "deleted": deleted_count,
        }), 200
    except Exception as e:
        session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        session.close()


@trade_bp.route("/<int:trade_id>", methods=["GET"])
def get_trade(trade_id):
    """
    Fetch a single trade by id. Returns 404 if it doesn't exist.
    """
    session = SessionLocal()
    try:
        trade = session.get(Trade, trade_id)
        if trade is None:
            return jsonify({"status": "error", "message": f"Trade {trade_id} not found"}), 404
        return jsonify({"status": "success", "data": trade.to_dict()}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        session.close()


@trade_bp.route("/<int:trade_id>", methods=["PUT"])
def update_trade(trade_id):
    """
    Update a trade by id. Accepts a partial body — only the fields
    provided are changed. Returns 404 if the trade doesn't exist.

    P&L is always recalculated after applying the update, using the
    trade's resulting (post-update) entry/exit/direction/lot_size/asset,
    so partial edits (e.g. just adding an exit price to close a trade
    that was created without one) still produce a correct P&L. result
    is then re-derived from that recalculated pnl via determine_result()
    — never taken from the request body — so result and pnl can never
    fall out of sync after a partial edit.
    """
    data = request.get_json(silent=True)
    cleaned, error = validate_trade_payload(data, partial=True)
    if error:
        return jsonify({"status": "error", "message": error}), 400

    if not cleaned:
        return jsonify({"status": "error", "message": "No valid fields provided to update"}), 400

    session = SessionLocal()
    try:
        trade = session.get(Trade, trade_id)
        if trade is None:
            return jsonify({"status": "error", "message": f"Trade {trade_id} not found"}), 404

        for field, value in cleaned.items():
            setattr(trade, field, value)

        # Recompute pnl from the trade's post-update state so partial
        # edits (e.g. only changing lot_size or only adding an exit
        # price) always leave pnl consistent with the stored fields.
        trade.pnl = calculate_pnl(
            asset=trade.asset,
            direction=trade.direction,
            entry=trade.entry,
            exit_price=trade.exit,
            lot_size=trade.lot_size,
        )
        # result is derived exclusively from the recomputed pnl, never
        # from cleaned["result"] even if the client sent one.
        trade.result = determine_result(trade.pnl)

        session.commit()
        session.refresh(trade)
        return jsonify({"status": "success", "data": trade.to_dict()}), 200
    except Exception as e:
        session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        session.close()


@trade_bp.route("/<int:trade_id>", methods=["DELETE"])
def delete_trade(trade_id):
    """
    Delete a trade by id. Returns 404 if it doesn't exist.
    """
    session = SessionLocal()
    try:
        trade = session.get(Trade, trade_id)
        if trade is None:
            return jsonify({"status": "error", "message": f"Trade {trade_id} not found"}), 404

        session.delete(trade)
        session.commit()
        return jsonify({"status": "success", "message": f"Trade {trade_id} deleted"}), 200
    except Exception as e:
        session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500
    finally:
        session.close()