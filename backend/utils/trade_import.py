"""
utils/trade_import.py
------------------------
Reusable CSV processing layer for bulk trade import.

Deliberately thin and database-free: it only turns a CSV file stream
into (valid_trades, validation_errors). It does not open a session,
insert rows, or touch the database in any way — that's the
responsibility of the route that calls this module.

Every row is run through the exact same pipeline a manually created
trade goes through in routes/trade_routes.py:

    validate_trade_payload() -> calculate_pnl() -> determine_result()

Reusing those three functions unchanged (rather than reimplementing
any part of validation or calculation here) is what guarantees a
CSV-imported trade and a manually entered trade are computed
identically, with a single source of truth for pnl and result.
"""

import csv
import io
from typing import IO, List, Tuple, Dict, Any

from utils.validators import validate_trade_payload
from utils.pnl import calculate_pnl, determine_result


def _normalize_row(raw_row: Dict[str, Any]) -> Dict[str, Any]:
    """
    Turn a raw csv.DictReader row into something validate_trade_payload()
    can consume cleanly:
      - drop any 'result' column entirely — result is never taken from
        the CSV, it's always derived from pnl via determine_result()
      - drop keys of None (csv.DictReader uses None as the key for any
        extra unnamed columns in a row; there's nothing valid to do
        with those)
      - strip whitespace from string values
      - convert empty strings to None so optional fields are correctly
        treated as absent rather than failing float()/date parsing
    """
    row: Dict[str, Any] = {}
    for key, value in raw_row.items():
        if key is None or key == "result":
            continue
        if value is None:
            row[key] = None
            continue
        stripped = value.strip()
        row[key] = stripped if stripped != "" else None
    return row


def process_trade_csv(file_stream: IO[bytes]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Parse and validate a CSV file of trades. Does not touch the database.

    Args:
        file_stream: a binary file-like object (e.g. FileStorage.stream
                     from a Flask upload).

    Returns:
        (valid_trades, validation_errors)

        valid_trades: list of cleaned dicts, each already validated via
        validate_trade_payload() and augmented with "pnl" (from
        calculate_pnl()) and "result" (from determine_result()). Each
        dict is ready to be passed straight into Trade(**cleaned) by
        the caller.

        validation_errors: list of {"row": <1-indexed row number>,
        "reason": <str>} for rows that failed validate_trade_payload().
        Row numbers account for the header row, so the first data row
        is row 2 (matching what a user would see if they opened the
        CSV in a spreadsheet app).
    """
    valid_trades: List[Dict[str, Any]] = []
    validation_errors: List[Dict[str, Any]] = []

    try:
        text_stream = io.TextIOWrapper(file_stream, encoding="utf-8-sig")
        reader = csv.DictReader(text_stream)
    except Exception as e:
        return [], [{"row": 0, "reason": f"Could not read CSV: {e}"}]

    if not reader.fieldnames:
        return [], [{"row": 0, "reason": "CSV file is empty or missing a header row"}]

    for row_number, raw_row in enumerate(reader, start=2):  # header is row 1
        row = _normalize_row(raw_row)

        cleaned, error = validate_trade_payload(row, partial=False)
        if error:
            validation_errors.append({"row": row_number, "reason": error})
            continue

        cleaned["pnl"] = calculate_pnl(
            asset=cleaned["asset"],
            direction=cleaned["direction"],
            entry=cleaned["entry"],
            exit_price=cleaned.get("exit"),
            lot_size=cleaned["lot_size"],
        )
        cleaned["result"] = determine_result(cleaned["pnl"])

        valid_trades.append(cleaned)

    return valid_trades, validation_errors