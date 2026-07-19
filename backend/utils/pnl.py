"""
utils/pnl.py
-------------
Helper functions for calculating realized profit/loss on a trade, and
for deriving a trade's win/loss/breakeven result from that P&L.

A raw (exit - entry) price difference is meaningless on its own — it
has to be scaled by how much of the underlying asset one "lot"
actually represents, and flipped in sign for short trades. That
scaling factor (contract size) differs per asset class:

    Forex  (EUR/USD) -> 100,000 base-currency units per standard lot
    Metals (XAU/USD)  -> 100 troy ounces per lot
    Crypto (BTC/USD)  -> 1 coin per lot
    Stocks (AAPL)     -> 100 shares per lot

To support a new asset, just add a row to ASSET_CONTRACT_SIZES below —
no other code needs to change.

determine_result() is the single source of truth for turning a pnl
value into a "win" / "loss" / "breakeven" label. Every code path that
creates or updates a trade (manual create, manual update, and CSV
import) must call this instead of accepting or deriving a result any
other way, so the label can never drift out of sync with the stored
pnl.
"""

from typing import Optional

# Units of the underlying asset represented by exactly 1.00 lot.
# Dollar P&L = (exit - entry) * contract_size * lot_size (sign-adjusted
# for direction).
ASSET_CONTRACT_SIZES = {
    "EUR/USD": 100_000,   # forex standard lot
    "XAU/USD": 100,       # gold: 100 oz per lot
    "BTC/USD": 1,         # crypto: 1 BTC per lot
    "AAPL": 100,          # stock CFD: 100 shares per lot
}

# Fallback for any asset not explicitly listed above — treats the price
# difference as a direct 1-unit-per-lot instrument rather than failing.
DEFAULT_CONTRACT_SIZE = 1

LONG_DIRECTIONS = {"buy", "long"}
SHORT_DIRECTIONS = {"sell", "short"}


def get_contract_size(asset: str) -> float:
    """Return the contract size (units per 1.00 lot) for a given asset."""
    return ASSET_CONTRACT_SIZES.get(asset, DEFAULT_CONTRACT_SIZE)


def calculate_pnl(
    asset: str,
    direction: str,
    entry: Optional[float],
    exit_price: Optional[float],
    lot_size: Optional[float],
) -> Optional[float]:
    """
    Calculate realized P&L (in account currency, USD) for a trade.

    Args:
        asset: instrument symbol, e.g. "EUR/USD", "XAU/USD", "BTC/USD", "AAPL".
        direction: "buy"/"long" or "sell"/"short".
        entry: entry price.
        exit_price: exit price, or None if the trade is still open.
        lot_size: position size in lots (e.g. 0.01, 0.5, 1.0).

    Returns:
        The rounded dollar P&L, or None if the trade can't be settled
        yet (missing exit price, entry, or lot size). Callers should
        treat None as "not realized" rather than coercing it to zero.
    """
    if entry is None or exit_price is None or lot_size is None:
        return None

    direction_key = (direction or "").strip().lower()
    contract_size = get_contract_size(asset)

    price_diff = exit_price - entry

    if direction_key in LONG_DIRECTIONS:
        signed_diff = price_diff
    elif direction_key in SHORT_DIRECTIONS:
        signed_diff = -price_diff
    else:
        # Validators should always catch an invalid direction before this
        # is ever called, but fail safe (0 P&L) rather than raise here.
        signed_diff = 0

    return round(signed_diff * contract_size * lot_size, 2)


def determine_result(pnl: Optional[float]) -> Optional[str]:
    """
    Derive a trade's result label from its P&L.

    This is the single source of truth for "win"/"loss"/"breakeven" —
    every trade-creating/updating code path calls this instead of
    accepting a client-supplied result, so the label can never drift
    out of sync with the actual pnl value.

    Args:
        pnl: the trade's realized P&L, or None if still open.

    Returns:
        "win" if pnl > 0, "loss" if pnl < 0, "breakeven" if pnl == 0,
        or None if pnl is None (open trade).
    """
    if pnl is None:
        return None
    if pnl > 0:
        return "win"
    if pnl < 0:
        return "loss"
    return "breakeven"