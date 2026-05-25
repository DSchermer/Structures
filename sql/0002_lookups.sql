-- Phase 0 lookups: system user + the 5 system tags from §5.2.
-- These rows are required for the prototype to function at all; later
-- seed files (0003+) layer real users / specs / structures on top.

INSERT INTO USER (id, username, display_name, role, is_admin, is_active, password_hash)
VALUES ('00000000-0000-0000-0000-000000000001', '__system__', 'System', 'engineer', 0, 0, '');

INSERT INTO TAG (id, name, name_lower, kind) VALUES
  ('10000000-0000-0000-0000-000000000001', 'archived',     'archived',     'system'),
  ('10000000-0000-0000-0000-000000000002', 'locked',       'locked',       'system'),
  ('10000000-0000-0000-0000-000000000003', 'subassembly',  'subassembly',  'system'),
  ('10000000-0000-0000-0000-000000000004', 'below-target', 'below-target', 'system'),
  ('10000000-0000-0000-0000-000000000005', 'superseded',   'superseded',   'system');
