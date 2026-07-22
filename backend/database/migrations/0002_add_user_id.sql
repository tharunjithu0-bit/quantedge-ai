-- Migration: 0002_add_user_id
-- ---------------------------------------
-- Adds the user_id column to `trades` so trades can be scoped per
-- authenticated user (see models/trade.py and routes/trade_routes.py).
--
-- New databases don't need this file -- init_db() (Base.metadata.create_all,
-- called via GET /create-db) will create the `trades` table with
-- user_id already included, since it's defined on the Trade model.
--
-- This script is only needed to bring an EXISTING `trades` table (one
-- created before user_id was added to the model) up to date, since
-- create_all() never alters already-existing tables.
--
-- IMPORTANT: run this only after at least one row exists in `users`.
-- The backfill step below assigns every pre-existing trade to the
-- earliest-registered user (MIN(id) in `users`) -- there is no way
-- for this script to know which human those old rows "really" belong
-- to, so if that default is wrong for your data, update user_id by
-- hand afterward with a plain UPDATE against the specific trade ids.
--
-- Usage:
--   mysql -u <user> -p <database> < 0002_add_user_id.sql
-- or via the bundled runner:
--   python migrate.py

ALTER TABLE trades
    ADD COLUMN user_id INT NULL AFTER id;

-- Backfill: assign every existing trade to the first (lowest id)
-- registered user. See the IMPORTANT note above.
UPDATE trades
SET user_id = (SELECT MIN(id) FROM users)
WHERE user_id IS NULL;

-- Now that every row has a user_id, enforce it going forward.
ALTER TABLE trades
    MODIFY COLUMN user_id INT NOT NULL;

ALTER TABLE trades
    ADD CONSTRAINT fk_trades_user
    FOREIGN KEY (user_id) REFERENCES users(id);

CREATE INDEX ix_trades_user_id ON trades (user_id);