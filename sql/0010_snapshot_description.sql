-- Retrofitted CR snapshots predate STRUCTURE.description, so the point-in-time
-- overlay fell through to live data for them — an OM user reading an older
-- assignment would see the current description, not the one committed.
--
-- Snapshots written by check-in already carry it; this patches the ones
-- generated from seed. The structure's present description is the only value
-- these revisions ever had.

UPDATE CONSTRUCTION_REVISION_SNAPSHOT
   SET snapshot_json = json_set(
         snapshot_json,
         '$.structure_fields.description',
         (SELECT s.description
            FROM CONSTRUCTION_REVISION cr
            JOIN STRUCTURE s ON s.id = cr.structure_id
           WHERE cr.id = CONSTRUCTION_REVISION_SNAPSHOT.construction_revision_id)
       )
 WHERE json_extract(snapshot_json, '$.structure_fields.description') IS NULL;
