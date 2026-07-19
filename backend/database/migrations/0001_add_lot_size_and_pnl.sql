-- Migration: 0001_add_lot_size_and_pnl
-- ---------------------------------------
-- Adds position-sizing (lot_size) and auto-calculated realized P&L (pnl)
-- to the `trades` table.
--
-- New databases don't need this file — `init_db()` (Base.metadata.create_all,
-- called via GET /create-db) will create the `trades` table with these
-- columns already included, since they're defined on the Trade model.
--
-- This script is only needed to bring an EXISTING `trades` table (created
-- before this change) up to date, since create_all() never alters
-- already-existing tables.
--
-- Usage:
--   mysql -u <user> -p <database> < 0001_add_lot_size_and_pnl.sql
-- or via the bundled runner:
--   python backend/migrate.py

ALTER TABLE trades
    ADD COLUMN lot_size FLOAT NOT NULL DEFAULT 1.0 AFTER take_profit;

ALTER TABLE trades
    ADD COLUMN pnl FLOAT NULL AFTER lot_size;

-- Backfill pnl for any pre-existing closed trades using the old
-- "raw price difference" convention (lot_size defaults to 1.0 above,
-- so this matches the previous frontend behavior for historical rows).
UPDATE trades
SET pnl = CASE
    WHEN exit IS NULL THEN NULL
    WHEN LOWER(direction) IN ('buy', 'long') THEN ROUND((exit - entry) * lot_size, 2)
    ELSE ROUND((entry - exit) * lot_size, 2)
END
WHERE pnl IS NULL;
