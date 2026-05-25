-- StructureV2 prototype — D1 (SQLite) schema
-- Mirrors §5.4 of problemstatement.md as closely as the demo flows require.
-- Out of scope at launch: STRUCTURE_TAG_HISTORY, SPEC_TAG_HISTORY,
-- PRICE_POINT_TAG_HISTORY, LOCK_OVERRIDE_LOG. The complex back-solve-driven
-- triggers (PRICE_POINT.scope materialisation, PRICE_POINT_TAG kind gating,
-- variant-tag sibling-distinctness, CHECKOUT_LOCK ⊕ `locked` mutex) live in
-- the application layer for the prototype; the seed data is curated so the
-- live state never violates them.
--
-- UUID columns are TEXT. The app generates UUIDs via crypto.randomUUID().
-- Timestamps are TEXT ISO-8601 (UTC).
-- Decimals are REAL (display rounds half-up to nearest cent at render).
-- Booleans are INTEGER (0/1).
-- JSON columns are TEXT; the app parses/serialises.

PRAGMA foreign_keys = ON;

----------------------------------------------------------------------
-- USER
----------------------------------------------------------------------
CREATE TABLE USER (
  id                    TEXT PRIMARY KEY,
  username              TEXT NOT NULL UNIQUE,
  password_hash         TEXT,
  password_set_at       TEXT,
  must_rotate_password  INTEGER NOT NULL DEFAULT 0,
  initials              TEXT,
  display_name          TEXT NOT NULL,
  role                  TEXT NOT NULL CHECK (role IN ('engineer','order_management')),
  is_admin              INTEGER NOT NULL DEFAULT 0,
  is_active             INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by_user_id    TEXT REFERENCES USER(id),
  CHECK (is_admin = 0 OR role = 'engineer')
);

CREATE UNIQUE INDEX ux_user_bootstrap
  ON USER(created_by_user_id)
  WHERE created_by_user_id IS NULL;

----------------------------------------------------------------------
-- TAG  (six kinds: spec, general, variant, cost, sell, system)
----------------------------------------------------------------------
CREATE TABLE TAG (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  name_lower  TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('spec','general','variant','cost','sell','system')),
  UNIQUE (name_lower, kind)
);

CREATE INDEX ix_tag_kind ON TAG(kind);

----------------------------------------------------------------------
-- SPEC + SPEC_REVISION + SPEC_TAG
----------------------------------------------------------------------
CREATE TABLE SPEC (
  id                  TEXT PRIMARY KEY,
  spec_number         TEXT NOT NULL UNIQUE,
  customer_revision   TEXT NOT NULL,
  created_by_user_id  TEXT NOT NULL REFERENCES USER(id),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE SPEC_REVISION (
  id                 TEXT PRIMARY KEY,
  spec_id            TEXT NOT NULL REFERENCES SPEC(id),
  customer_revision  TEXT NOT NULL,
  author_user_id     TEXT NOT NULL REFERENCES USER(id),
  recorded_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  notes              TEXT,
  change_set         TEXT NOT NULL  -- JSON
);

CREATE INDEX ix_specrev_spec ON SPEC_REVISION(spec_id, recorded_at);

CREATE TABLE SPEC_TAG (
  spec_id             TEXT NOT NULL REFERENCES SPEC(id),
  tag_id              TEXT NOT NULL REFERENCES TAG(id),
  applied_by_user_id  TEXT NOT NULL REFERENCES USER(id),
  applied_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reason              TEXT,
  PRIMARY KEY (spec_id, tag_id)
);

----------------------------------------------------------------------
-- STRUCTURE (single table for base parts AND variants)
--   variant ⟺ parent_structure_id IS NOT NULL
--   variant depth = 1 (parent.parent_structure_id MUST be NULL)
--   top_level_part_number is derived: spec_number || part_number
--     SQLite generated columns cannot reference other tables, so the
--     app computes this via JOIN on read; a covering view (below) helps.
----------------------------------------------------------------------
CREATE TABLE STRUCTURE (
  id                                    TEXT PRIMARY KEY,
  part_number                           TEXT NOT NULL CHECK (
    length(part_number) BETWEEN 1 AND 25
    AND substr(part_number, 1, 1) <> ' '
    AND substr(part_number, length(part_number), 1) <> ' '
  ),
  spec_id                               TEXT NOT NULL REFERENCES SPEC(id),
  spec_revision_id                      TEXT NOT NULL REFERENCES SPEC_REVISION(id),
  parent_structure_id                   TEXT REFERENCES STRUCTURE(id),
  current_construction_revision_number  INTEGER NOT NULL DEFAULT 0 CHECK (current_construction_revision_number >= 0),
  current_price_revision_number         INTEGER NOT NULL DEFAULT 0 CHECK (current_price_revision_number >= 0),
  build_hours                           REAL,
  target_assembly_margin_pct            REAL CHECK (target_assembly_margin_pct IS NULL OR (target_assembly_margin_pct >= 0 AND target_assembly_margin_pct < 1)),
  build_instr_1                         TEXT,
  build_instr_2                         TEXT,
  build_instr_3                         TEXT,
  build_instr_4                         TEXT,
  build_instr_5                         TEXT,
  work_instr_1                          TEXT,
  work_instr_2                          TEXT,
  work_instr_3                          TEXT,
  work_instr_4                          TEXT,
  work_instr_5                          TEXT,
  created_by_user_id                    TEXT NOT NULL REFERENCES USER(id),
  created_at                            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (spec_id, part_number)
);

CREATE INDEX ix_structure_spec   ON STRUCTURE(spec_id);
CREATE INDEX ix_structure_parent ON STRUCTURE(parent_structure_id);

-- Convenience view: STRUCTURE + derived top_level_part_number + spec_number.
CREATE VIEW STRUCTURE_VIEW AS
SELECT
  s.*,
  sp.spec_number,
  (sp.spec_number || s.part_number) AS top_level_part_number
FROM STRUCTURE s
JOIN SPEC sp ON sp.id = s.spec_id;

----------------------------------------------------------------------
-- STRUCTURE_TAG (general | variant | system kinds)
----------------------------------------------------------------------
CREATE TABLE STRUCTURE_TAG (
  structure_id        TEXT NOT NULL REFERENCES STRUCTURE(id),
  tag_id              TEXT NOT NULL REFERENCES TAG(id),
  applied_by_user_id  TEXT NOT NULL REFERENCES USER(id),
  applied_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reason              TEXT,
  PRIMARY KEY (structure_id, tag_id)
);

CREATE INDEX ix_structuretag_tag ON STRUCTURE_TAG(tag_id);

----------------------------------------------------------------------
-- CONSTRUCTION_REVISION (CR — customer-facing build identity)
-- PRICE_REVISION       (PR — internal pricing audit)
----------------------------------------------------------------------
CREATE TABLE CONSTRUCTION_REVISION (
  id               TEXT PRIMARY KEY,
  structure_id     TEXT NOT NULL REFERENCES STRUCTURE(id),
  revision_number  INTEGER NOT NULL,
  author_user_id   TEXT NOT NULL REFERENCES USER(id),
  committed_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  change_set       TEXT NOT NULL,   -- JSON; never empty (gate G1)
  notes            TEXT,
  UNIQUE (structure_id, revision_number)
);

CREATE INDEX ix_cr_structure ON CONSTRUCTION_REVISION(structure_id, revision_number DESC);

CREATE TABLE PRICE_REVISION (
  id               TEXT PRIMARY KEY,
  structure_id     TEXT NOT NULL REFERENCES STRUCTURE(id),
  revision_number  INTEGER NOT NULL,
  author_user_id   TEXT NOT NULL REFERENCES USER(id),
  committed_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  change_set       TEXT NOT NULL,
  notes            TEXT,
  UNIQUE (structure_id, revision_number)
);

CREATE INDEX ix_pr_structure ON PRICE_REVISION(structure_id, revision_number DESC);

----------------------------------------------------------------------
-- PRICE_POINT (three scopes: component_cost | subassembly_cost | structure_sell)
--   Exactly one of (component_part_number, structure_id) is set.
--   component_cost rows require quote_number.
--   structure_sell + subassembly_cost rows carry (CR, PR) provenance.
----------------------------------------------------------------------
CREATE TABLE PRICE_POINT (
  id                                     TEXT PRIMARY KEY,
  component_part_number                  TEXT,
  structure_id                           TEXT REFERENCES STRUCTURE(id),
  scope                                  TEXT NOT NULL CHECK (scope IN ('component_cost','subassembly_cost','structure_sell')),
  price                                  REAL NOT NULL CHECK (price >= 0),
  quote_number                           TEXT,
  derived_from_construction_revision_id  TEXT REFERENCES CONSTRUCTION_REVISION(id),
  derived_from_price_revision_id         TEXT REFERENCES PRICE_REVISION(id),
  set_by_user_id                         TEXT NOT NULL REFERENCES USER(id),
  set_at                                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (
    (component_part_number IS NOT NULL AND structure_id IS NULL)
    OR
    (component_part_number IS NULL AND structure_id IS NOT NULL)
  ),
  -- component_cost rows must carry a supplier quote reference
  CHECK (scope <> 'component_cost' OR quote_number IS NOT NULL),
  -- scope alignment vs. the (component_part_number, structure_id) pair
  CHECK (
    (scope = 'component_cost'    AND component_part_number IS NOT NULL AND structure_id IS NULL)
    OR
    (scope IN ('subassembly_cost','structure_sell') AND structure_id IS NOT NULL AND component_part_number IS NULL)
  ),
  -- derived_from_* required for structure_sell + subassembly_cost
  CHECK (
    scope = 'component_cost'
    OR (derived_from_construction_revision_id IS NOT NULL AND derived_from_price_revision_id IS NOT NULL)
  )
);

CREATE INDEX ix_pp_component ON PRICE_POINT(component_part_number) WHERE component_part_number IS NOT NULL;
CREATE INDEX ix_pp_structure ON PRICE_POINT(structure_id) WHERE structure_id IS NOT NULL;
CREATE INDEX ix_pp_set_at    ON PRICE_POINT(set_at DESC, id DESC);

CREATE TABLE PRICE_POINT_TAG (
  price_point_id      TEXT NOT NULL REFERENCES PRICE_POINT(id),
  tag_id              TEXT NOT NULL REFERENCES TAG(id),
  applied_by_user_id  TEXT NOT NULL REFERENCES USER(id),
  applied_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reason              TEXT,
  PRIMARY KEY (price_point_id, tag_id)
);

----------------------------------------------------------------------
-- LINE_ITEM (live; promotion target of DRAFT_LINE_ITEM)
--   Exactly one of (chosen_price_point_id, price_override) is set.
--   commission_cap_pct strictly in (0, 1) iff is_commissioned.
----------------------------------------------------------------------
CREATE TABLE LINE_ITEM (
  id                         TEXT PRIMARY KEY,
  structure_id               TEXT NOT NULL REFERENCES STRUCTURE(id),
  sort_order                 INTEGER NOT NULL CHECK (sort_order >= 1),
  component_part_number      TEXT NOT NULL CHECK (
    substr(component_part_number, 1, 1) <> ' '
    AND substr(component_part_number, length(component_part_number), 1) <> ' '
  ),
  part_description           TEXT NOT NULL,
  quantity                   REAL NOT NULL CHECK (quantity > 0),
  chosen_price_point_id      TEXT REFERENCES PRICE_POINT(id),
  price_override             REAL CHECK (price_override IS NULL OR price_override >= 0),
  price_confirmed            TEXT,
  supplier                   TEXT NOT NULL,
  lead_time_days             INTEGER NOT NULL,
  product_code               TEXT NOT NULL,
  is_commissioned            INTEGER NOT NULL DEFAULT 0,
  commission_cap_pct         REAL,
  sub_assembly_structure_id  TEXT REFERENCES STRUCTURE(id),
  -- exactly one of chosen_price_point_id / price_override
  CHECK (((chosen_price_point_id IS NOT NULL) + (price_override IS NOT NULL)) = 1),
  -- commission_cap_pct constraints
  CHECK (
    (is_commissioned = 0 AND commission_cap_pct IS NULL)
    OR
    (is_commissioned = 1 AND commission_cap_pct > 0 AND commission_cap_pct < 1)
  )
);

CREATE INDEX ix_li_structure ON LINE_ITEM(structure_id, sort_order);
CREATE INDEX ix_li_component ON LINE_ITEM(component_part_number);

----------------------------------------------------------------------
-- CHECKOUT_LOCK (one per STRUCTURE; covers BOTH CR + PR edits)
----------------------------------------------------------------------
CREATE TABLE CHECKOUT_LOCK (
  structure_id    TEXT PRIMARY KEY REFERENCES STRUCTURE(id),
  holder_user_id  TEXT NOT NULL REFERENCES USER(id),
  acquired_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX ix_lock_holder ON CHECKOUT_LOCK(holder_user_id);

----------------------------------------------------------------------
-- DRAFT_STRUCTURE / DRAFT_LINE_ITEM / DRAFT_STRUCTURE_TAG
--   Shadow tables — only the lock-holder sees draft state.
--   Drafts may transiently violate live CHECKs; the §5.7 cascade
--   enforces them at commit.
----------------------------------------------------------------------
CREATE TABLE DRAFT_STRUCTURE (
  structure_id                TEXT PRIMARY KEY REFERENCES STRUCTURE(id),
  editor_user_id              TEXT NOT NULL REFERENCES USER(id),
  part_number                 TEXT,
  spec_id                     TEXT REFERENCES SPEC(id),
  spec_revision_id            TEXT REFERENCES SPEC_REVISION(id),
  parent_structure_id         TEXT REFERENCES STRUCTURE(id),
  build_hours                 REAL,
  target_assembly_margin_pct  REAL,
  build_instr_1               TEXT,
  build_instr_2               TEXT,
  build_instr_3               TEXT,
  build_instr_4               TEXT,
  build_instr_5               TEXT,
  work_instr_1                TEXT,
  work_instr_2                TEXT,
  work_instr_3                TEXT,
  work_instr_4                TEXT,
  work_instr_5                TEXT,
  draft_started_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_edited_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE DRAFT_LINE_ITEM (
  id                         TEXT PRIMARY KEY,
  structure_id               TEXT NOT NULL REFERENCES STRUCTURE(id),
  sort_order                 INTEGER NOT NULL,
  component_part_number      TEXT,
  part_description           TEXT,
  quantity                   REAL,
  chosen_price_point_id      TEXT REFERENCES PRICE_POINT(id),
  price_override             REAL,
  price_confirmed            TEXT,
  supplier                   TEXT,
  lead_time_days             INTEGER,
  product_code               TEXT,
  is_commissioned            INTEGER NOT NULL DEFAULT 0,
  commission_cap_pct         REAL,
  sub_assembly_structure_id  TEXT REFERENCES STRUCTURE(id)
);

CREATE INDEX ix_dli_structure ON DRAFT_LINE_ITEM(structure_id, sort_order);

CREATE TABLE DRAFT_STRUCTURE_TAG (
  structure_id        TEXT NOT NULL REFERENCES STRUCTURE(id),
  tag_id              TEXT NOT NULL REFERENCES TAG(id),
  applied_by_user_id  TEXT NOT NULL REFERENCES USER(id),
  applied_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reason              TEXT,
  PRIMARY KEY (structure_id, tag_id)
);

----------------------------------------------------------------------
-- ASSIGNMENT (OM handoff) — CR-only; PR commits never create assignments
----------------------------------------------------------------------
CREATE TABLE ASSIGNMENT (
  id                        TEXT PRIMARY KEY,
  structure_id              TEXT NOT NULL REFERENCES STRUCTURE(id),
  construction_revision_id  TEXT NOT NULL REFERENCES CONSTRUCTION_REVISION(id),
  assigned_by_user_id       TEXT NOT NULL REFERENCES USER(id),
  assigned_to_user_id       TEXT NOT NULL REFERENCES USER(id),
  assigned_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  note                      TEXT,
  acknowledged              INTEGER NOT NULL DEFAULT 0,
  acknowledged_at           TEXT,
  UNIQUE (construction_revision_id, assigned_to_user_id),
  CHECK (
    (acknowledged = 0 AND acknowledged_at IS NULL)
    OR
    (acknowledged = 1 AND acknowledged_at IS NOT NULL)
  )
);

CREATE INDEX ix_assign_recipient ON ASSIGNMENT(assigned_to_user_id, acknowledged, assigned_at DESC);
CREATE INDEX ix_assign_sender    ON ASSIGNMENT(assigned_by_user_id, assigned_at DESC);
