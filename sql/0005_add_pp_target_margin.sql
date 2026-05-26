-- Add target_assembly_margin_pct to PRICE_POINT.
--
-- A sell or sub-assembly-cost PP is the output of running the back-solve
-- against a (CR, PR) cost-pin snapshot at a specific target margin. The
-- target margin used to compute the PP is part of the PP's identity —
-- if you change the structure's target margin later, you should NOT
-- retroactively change what the old prices meant.
--
-- Previously the target lived only on STRUCTURE. This denormalizes it
-- onto each PP so the price's basis is self-contained.

ALTER TABLE PRICE_POINT ADD COLUMN target_assembly_margin_pct REAL;

-- Backfill existing PPs with the structure's current target margin.
-- (Historical fidelity not recoverable for rows committed before this
--  column existed — we capture the right value from now on.)
UPDATE PRICE_POINT
SET target_assembly_margin_pct = (
  SELECT s.target_assembly_margin_pct
  FROM STRUCTURE s
  WHERE s.id = PRICE_POINT.structure_id
)
WHERE structure_id IS NOT NULL
  AND scope IN ('structure_sell', 'subassembly_cost');
