-- COMPONENT — the canonical record for a purchased part.
--
-- Before this table, a component's description lived only on LINE_ITEM, once per
-- structure that used it. Nothing kept those copies in agreement, and they
-- didn't: 27 of 48 components carried two or more different descriptions, some
-- of them fragments ("6in 300#") rather than descriptions. The price library had
-- no description at all — a component_cost PRICE_POINT showed a bare part number.
--
-- COMPONENT gives each part one description that the price library reads and
-- that BOM entry pre-fills from, so new lines are consistent by construction.
-- The default_* columns capture the fields an engineer would otherwise retype on
-- every line; they are defaults at entry time, NOT constraints — a line may
-- legitimately differ (different supplier for one job, expedited lead time).
--
-- LINE_ITEM.part_description is deliberately NOT rewritten. Those values are
-- CR-side committed state referenced by CONSTRUCTION_REVISION snapshots; editing
-- them behind the revision model's back would desync live rows from their own
-- history. Existing lines converge as engineers revise them normally.

CREATE TABLE COMPONENT (
  component_part_number   TEXT PRIMARY KEY,
  description             TEXT NOT NULL,
  default_supplier        TEXT,
  default_product_code    TEXT,
  default_lead_time_days  INTEGER,
  created_by_user_id      TEXT REFERENCES USER(id),
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at              TEXT
);

-- Seed from what the catalog already knows. For each field take the most common
-- value across that component's line items; break ties on description by length,
-- so a full description wins over a fragment of one.
INSERT INTO COMPONENT
  (component_part_number, description, default_supplier, default_product_code, default_lead_time_days, created_by_user_id)
SELECT
  li.component_part_number,
  (SELECT x.part_description FROM LINE_ITEM x
    WHERE x.component_part_number = li.component_part_number
      AND x.part_description IS NOT NULL AND TRIM(x.part_description) <> ''
    GROUP BY x.part_description
    ORDER BY COUNT(*) DESC, LENGTH(x.part_description) DESC
    LIMIT 1),
  (SELECT x.supplier FROM LINE_ITEM x
    WHERE x.component_part_number = li.component_part_number AND x.supplier IS NOT NULL
    GROUP BY x.supplier ORDER BY COUNT(*) DESC LIMIT 1),
  (SELECT x.product_code FROM LINE_ITEM x
    WHERE x.component_part_number = li.component_part_number AND x.product_code IS NOT NULL
    GROUP BY x.product_code ORDER BY COUNT(*) DESC LIMIT 1),
  (SELECT x.lead_time_days FROM LINE_ITEM x
    WHERE x.component_part_number = li.component_part_number AND x.lead_time_days IS NOT NULL
    GROUP BY x.lead_time_days ORDER BY COUNT(*) DESC LIMIT 1),
  '00000000-0000-0000-0000-000000000001'
FROM LINE_ITEM li
GROUP BY li.component_part_number;

-- Any component that exists only in the price library (quoted but never used on
-- a BOM) still needs a row; its description starts as the part number for an
-- engineer to correct.
INSERT INTO COMPONENT (component_part_number, description, created_by_user_id)
SELECT DISTINCT pp.component_part_number, pp.component_part_number,
       '00000000-0000-0000-0000-000000000001'
FROM PRICE_POINT pp
WHERE pp.scope = 'component_cost'
  AND pp.component_part_number IS NOT NULL
  AND pp.component_part_number NOT IN (SELECT component_part_number FROM COMPONENT);

CREATE INDEX ix_component_description ON COMPONENT(description);
