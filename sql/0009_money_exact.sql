-- Exact money storage.
--
-- §5.5 specifies PRICE_POINT.price as DECIMAL(19,4) — 0.01¢ precision, chosen so
-- the back-solve can compute intermediates without rounding drift — and requires
-- the price written at check-in to be rounded half-up to the cent. The prototype
-- declared these columns REAL, i.e. IEEE-754 binary floating point, and never
-- rounded. A contractual commission cap was therefore riding on a type that
-- cannot represent 0.10 exactly.
--
-- SQLite has no decimal type, so money moves to INTEGER counts of
-- ten-thousandths of a currency unit ("e4"). That is the DECIMAL(19,4) contract
-- expressed in the only exact numeric type SQLite offers.
--
-- The original REAL columns are kept and written alongside, because the table's
-- CHECK constraints reference `price` and SQLite cannot drop a column a CHECK
-- depends on. `*_e4` is authoritative on read; the REAL column is derived from
-- it on every write and exists for legibility in a SQL console.
-- A production build on Postgres should use NUMERIC(19,4) and carry one column.

ALTER TABLE PRICE_POINT      ADD COLUMN price_e4          INTEGER;
ALTER TABLE LINE_ITEM        ADD COLUMN price_override_e4 INTEGER;
ALTER TABLE DRAFT_LINE_ITEM  ADD COLUMN price_override_e4 INTEGER;

-- Backfill. ROUND() before CAST so 12.35 stored as 12.349999... lands on
-- 123500 rather than truncating to 123499.
UPDATE PRICE_POINT
   SET price_e4 = CAST(ROUND(price * 10000) AS INTEGER)
 WHERE price IS NOT NULL;

UPDATE LINE_ITEM
   SET price_override_e4 = CAST(ROUND(price_override * 10000) AS INTEGER)
 WHERE price_override IS NOT NULL;

UPDATE DRAFT_LINE_ITEM
   SET price_override_e4 = CAST(ROUND(price_override * 10000) AS INTEGER)
 WHERE price_override IS NOT NULL;

CREATE INDEX ix_pp_price_e4 ON PRICE_POINT(price_e4);
