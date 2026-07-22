"""
migrate.py
-----------
Migration runner for existing databases that predate columns added
after the initial schema (lot_size/pnl, and now user_id).

Brand-new databases don't need this — hitting GET /create-db (which
calls init_db() / Base.metadata.create_all()) already creates every
table with all current columns included, since they're defined
directly on the models.

Tracking:
  Applied migrations are recorded in a `schema_migrations` table
  (filename + applied_at), created automatically on first run. This
  makes `python migrate.py` safe to run repeatedly and in any
  environment — it only executes migrations that haven't been applied
  yet, in filename order, so old ones are never rerun.

Bootstrapping note:
  0001_add_lot_size_and_pnl.sql was applied to this project's existing
  databases BEFORE schema_migrations existed. The first time this
  script runs against such a database, the tracking table is empty
  even though 0001 has already run. To handle that safely, on an
  EMPTY schema_migrations table this script records 0001 as applied
  WITHOUT re-executing its SQL, then proceeds to apply any migrations
  after it (0002 onward) normally.

  This bootstrap step only fires once — the moment schema_migrations
  has any row in it (which happens the first time you run this
  script), it's never triggered again. If you're setting up a brand
  new database from scratch, don't run this script at all — GET
  /create-db already includes everything 0001 and 0002 do.

Usage:
    python migrate.py
"""

import os
from sqlalchemy import text

from database.db import engine

MIGRATIONS_DIR = os.path.join(os.path.dirname(__file__), "database", "migrations")

# The first migration ever created for this project. Special-cased
# only for the bootstrap step described above — never re-executed by
# this script under any other circumstance.
BASELINE_MIGRATION = "0001_add_lot_size_and_pnl.sql"


def _strip_sql_comments(sql: str) -> str:
    """
    Drop full-line '--' comments before splitting the file on ';'.

    Splitting on ';' first and only checking whether each resulting
    chunk *starts with* '--' (the previous approach) silently drops
    real statements: a comment header followed by a statement with no
    ';' in between becomes a single chunk that starts with '--', so
    the whole chunk — including the real SQL — gets filtered out.
    Stripping comment lines up front, before splitting, avoids that.
    """
    return "\n".join(line for line in sql.splitlines() if not line.strip().startswith("--"))


def _ensure_migrations_table():
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS schema_migrations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                filename VARCHAR(255) NOT NULL UNIQUE,
                applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """))


def _applied_migrations():
    with engine.begin() as conn:
        rows = conn.execute(text("SELECT filename FROM schema_migrations")).fetchall()
    return {row[0] for row in rows}


def _record_migration(conn, filename):
    conn.execute(
        text("INSERT INTO schema_migrations (filename) VALUES (:filename)"),
        {"filename": filename},
    )


def _all_migration_files():
    return sorted(f for f in os.listdir(MIGRATIONS_DIR) if f.endswith(".sql"))


def run_migration(filename: str):
    """Execute one .sql file's statements and record it as applied."""
    path = os.path.join(MIGRATIONS_DIR, filename)
    with open(path, "r") as f:
        sql = f.read()

    cleaned = _strip_sql_comments(sql)
    statements = [s.strip() for s in cleaned.split(";") if s.strip()]

    with engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))
        _record_migration(conn, filename)

    print(f"Applied migration: {filename}")


def run_pending_migrations():
    _ensure_migrations_table()
    applied = _applied_migrations()
    all_files = _all_migration_files()

    # Bootstrap: see the module docstring. Only fires the very first
    # time this runs against a database that already had 0001 applied
    # by hand before tracking existed.
    if not applied and BASELINE_MIGRATION in all_files:
        with engine.begin() as conn:
            _record_migration(conn, BASELINE_MIGRATION)
        print(f"Recorded baseline migration (not re-run): {BASELINE_MIGRATION}")
        applied = {BASELINE_MIGRATION}

    pending = [f for f in all_files if f not in applied]

    if not pending:
        print("No pending migrations.")
        return

    for filename in pending:
        run_migration(filename)


if __name__ == "__main__":
    run_pending_migrations()