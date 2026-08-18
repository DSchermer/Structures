-- COMPONENT — the canonical record for a purchased part.
--
-- Description previously lived only on LINE_ITEM, once per structure that used
-- the part, and nothing kept those copies in agreement: 27 of 48 components had
-- drifted. Putting it on PRICE_POINT would only move the drift, since price
-- points are append-only per quote.
--
-- default_* are entry-time conveniences, NOT constraints — a line may
-- legitimately differ (other supplier, expedited lead time).

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

-- Most common value per component; ties on description break by length, so a
-- full description beats a fragment of one.
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

-- Quoted but never used on a BOM: seed the part number as a placeholder.
INSERT INTO COMPONENT (component_part_number, description, created_by_user_id)
SELECT DISTINCT pp.component_part_number, pp.component_part_number,
       '00000000-0000-0000-0000-000000000001'
FROM PRICE_POINT pp
WHERE pp.scope = 'component_cost'
  AND pp.component_part_number IS NOT NULL
  AND pp.component_part_number NOT IN (SELECT component_part_number FROM COMPONENT);

CREATE INDEX ix_component_description ON COMPONENT(description);
