-- Exact money. §5.5 specifies DECIMAL(19,4); SQLite has no decimal type, so
-- money is an INTEGER count of ten-thousandths of a unit ("e4").
--
-- The REAL columns stay because table CHECKs reference `price` and SQLite
-- cannot drop a column a CHECK depends on. price_e4 is authoritative on read;
-- the REAL column is derived from it on write. Postgres should use
-- NUMERIC(19,4) and carry one column.

ALTER TABLE PRICE_POINT      ADD COLUMN price_e4          INTEGER;
ALTER TABLE LINE_ITEM        ADD COLUMN price_override_e4 INTEGER;
ALTER TABLE DRAFT_LINE_ITEM  ADD COLUMN price_override_e4 INTEGER;

-- ROUND() before CAST: 12.35 is stored as 12.349999... and would truncate low.
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
