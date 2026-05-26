-- FK-safe wipe: delete dependents before parents, NULL out self-refs.
-- D1 enforces foreign keys, so order matters.

-- Audit + join tables (leaf)
DELETE FROM CONSTRUCTION_REVISION_SNAPSHOT;
DELETE FROM ASSIGNMENT;
DELETE FROM PRICE_POINT_TAG;
DELETE FROM STRUCTURE_TAG;
DELETE FROM SPEC_TAG;
DELETE FROM DRAFT_STRUCTURE_TAG;

-- Line items reference PRICE_POINT and STRUCTURE
DELETE FROM LINE_ITEM;
DELETE FROM DRAFT_LINE_ITEM;

-- Draft + locks reference STRUCTURE
DELETE FROM DRAFT_STRUCTURE;
DELETE FROM CHECKOUT_LOCK;

-- PRICE_POINT references STRUCTURE, CR, PR — wait until LINE_ITEMs gone
DELETE FROM PRICE_POINT;

-- Revisions reference STRUCTURE
DELETE FROM CONSTRUCTION_REVISION;
DELETE FROM PRICE_REVISION;

-- STRUCTURE self-reference: variants (parent_structure_id IS NOT NULL) first, then bases
DELETE FROM STRUCTURE WHERE parent_structure_id IS NOT NULL;
DELETE FROM STRUCTURE;

-- Spec rev → spec
DELETE FROM SPEC_REVISION;
DELETE FROM SPEC;

-- TAG comes after all *_TAG join tables (which we cleared above)
DELETE FROM TAG;

-- USER has self-ref created_by_user_id. NULL them out first, then delete.
UPDATE USER SET created_by_user_id = NULL;
DELETE FROM USER;
