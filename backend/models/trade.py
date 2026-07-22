"""
models/trade.py
-----------------
ORM model for a single trade journal entry. Fields mirror what the
React frontend's Trade Journal captures per trade.

This module only defines the table shape — no query/CRUD logic here.
That comes in a later step (routes + session usage).
"""

from sqlalchemy import Column, Integer, String, Float, Date, DateTime, Text, ForeignKey
from sqlalchemy.sql import func

from database.db import Base


class Trade(Base):
    __tablename__ = "trades"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Owning user. Every trade belongs to exactly one user; trades are
    # never shared or global. Always set server-side from the JWT-derived
    # current_user in routes/trade_routes.py — never trusted from the
    # request body (validate_trade_payload() doesn't accept a user_id
    # field at all, so this can't be spoofed by the client).
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    asset = Column(String(50), nullable=False)          # e.g. "EUR/USD", "BTC/USD"
    direction = Column(String(10), nullable=False)        # "buy" / "sell" (long/short)

    entry = Column(Float, nullable=False)                 # entry price
    exit = Column(Float, nullable=True)                   # exit price (null while open)
    stop_loss = Column(Float, nullable=True)
    take_profit = Column(Float, nullable=True)

    lot_size = Column(Float, nullable=False, default=1.0)  # position size, e.g. 0.01 - 2.00
    pnl = Column(Float, nullable=True)                     # realized profit/loss, auto-calculated
                                                             # from entry/exit/direction/lot_size/asset
                                                             # (see utils/pnl.py). Null while trade is open.

    setup_type = Column(String(100), nullable=True)       # e.g. "breakout", "pullback"
    result = Column(String(20), nullable=True)             # "win" / "loss" / "breakeven"

    trade_date = Column(Date, nullable=False)              # date the trade was taken
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    def __repr__(self):
        return f"<Trade id={self.id} asset={self.asset} direction={self.direction}>"

    def to_dict(self):
        """Serialize the model into a JSON-friendly dict."""
        return {
            "id": self.id,
            "asset": self.asset,
            "direction": self.direction,
            "entry": self.entry,
            "exit": self.exit,
            "stop_loss": self.stop_loss,
            "take_profit": self.take_profit,
            "lot_size": self.lot_size,
            "pnl": self.pnl,
            "setup_type": self.setup_type,
            "result": self.result,
            "trade_date": self.trade_date.isoformat() if self.trade_date else None,
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }