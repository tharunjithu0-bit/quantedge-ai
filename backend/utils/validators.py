"""
utils/validators.py
---------------------
Small, framework-agnostic validation helpers shared across routes.
Kept separate from the routes themselves so validation logic isn't
tangled up with request/response handling.
"""

from datetime import datetime

REQUIRED_TRADE_FIELDS = ["asset", "direction", "entry", "trade_date", "lot_size"]

VALID_DIRECTIONS = {"buy", "sell", "long", "short"}

VALID_ASSETS = {
    "EUR/USD",
    "XAU/USD",
    "BTC/USD",
    "AAPL",
}


def parse_date(value):
    """
    Parse a 'YYYY-MM-DD' string into a date object.
    Raises ValueError with a clear message if the format is wrong.
    """
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        raise ValueError("trade_date must be in YYYY-MM-DD format")


def parse_float(value, field_name):
    """Coerce a value to float, raising a clear error if it can't be."""
    try:
        return float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field_name} must be a number")


def validate_trade_payload(data, partial=False):
    """
    Validate a trade payload dict.

    Args:
        data: the parsed JSON body (dict).
        partial: if True, only validates fields that are present
                 (used for PUT/update, where not every field is required).

    Returns:
        (cleaned: dict, error: str | None)
        `cleaned` contains only the recognized, type-checked fields.
        If `error` is not None, validation failed and `cleaned` should
        be ignored.
    """
    if not isinstance(data, dict):
        return {}, "Request body must be a JSON object"

    if not partial:
        missing = [f for f in REQUIRED_TRADE_FIELDS if f not in data or data[f] in (None, "")]
        if missing:
            return {}, f"Missing required field(s): {', '.join(missing)}"

    cleaned = {}

    try:
        if "asset" in data:
            asset = str(data["asset"]).strip()
            if not asset:
                return {}, "asset cannot be empty"
            if asset not in VALID_ASSETS:
                return {}, f"asset must be one of: {', '.join(sorted(VALID_ASSETS))}"
            cleaned["asset"] = asset

        if "direction" in data:
            direction = str(data["direction"]).strip().lower()
            if direction not in VALID_DIRECTIONS:
                return {}, f"direction must be one of: {', '.join(sorted(VALID_DIRECTIONS))}"
            cleaned["direction"] = direction

        if "entry" in data:
            cleaned["entry"] = parse_float(data["entry"], "entry")

        if "lot_size" in data:
            lot_size = parse_float(data["lot_size"], "lot_size")
            if lot_size <= 0:
                return {}, "lot_size must be greater than 0"
            cleaned["lot_size"] = lot_size

        if "exit" in data and data["exit"] is not None:
            cleaned["exit"] = parse_float(data["exit"], "exit")

        if "stop_loss" in data and data["stop_loss"] is not None:
            cleaned["stop_loss"] = parse_float(data["stop_loss"], "stop_loss")

        if "take_profit" in data and data["take_profit"] is not None:
            cleaned["take_profit"] = parse_float(data["take_profit"], "take_profit")

        if "setup_type" in data:
            cleaned["setup_type"] = (
                str(data["setup_type"]).strip() if data["setup_type"] else None
            )

        if "result" in data:
            cleaned["result"] = str(data["result"]).strip() if data["result"] else None

        if "trade_date" in data:
            cleaned["trade_date"] = parse_date(data["trade_date"])

        if "notes" in data:
            cleaned["notes"] = str(data["notes"]) if data["notes"] else None

    except ValueError as e:
        return {}, str(e)

    return cleaned, None