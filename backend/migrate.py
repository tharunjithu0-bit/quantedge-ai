"""
migrate.py
-----------
Tiny migration runner for existing databases that predate the
lot_size/pnl columns on `trades`.

Brand-new databases don't need this — hitting GET /create-db (which
calls init_db() / Base.metadata.create_all()) already creates the
`trades` table with lot_size and pnl included, since they're defined
directly on the Trade model.

Usage:
    python migrate.py
"""

import os
from sqlalchemy import text

from database.db import engine

MIGRATIONS_DIR = os.path.join(os.path.dirname(__file__), "database", "migrations")


def run_migration(filename: str):
    path = os.path.join(MIGRATIONS_DIR, filename)
    with open(path, "r") as f:
        sql = f.read()

    # Split on ';' so multi-statement .sql files run as separate statements
    # (MySQL's DBAPI driver here doesn't support multi-statement execute).
    statements = [s.strip() for s in sql.split(";") if s.strip() and not s.strip().startswith("--")]

    with engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))

    print(f"Applied migration: {filename}")


if __name__ == "__main__":
    run_migration("0001_add_lot_size_and_pnl.sql")
