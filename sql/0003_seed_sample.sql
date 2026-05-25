-- Phase 1 sanity-check seed — 3 SPECs to confirm domain conventions
-- read right before Phase 2 scales to the full 18-22 spec catalog.
--
-- Conventions per Dylan's domain answers:
--   Spec numbers:    NNN T NNNN (e.g. 217T4501)  — 3-digit prefix is random
--   Part numbers:    P001 base, P001-XXX hyphen-suffix variants
--   Materials:       Common API/ASME set (CS-A105, LCC-A352, 316SS, Duplex-2205, Inconel-625, Monel-400)
--   End connections: RF-/RTJ-/BW-/SW-/NPT- per ASME B16.5/B16.25
--   Pressure class:  150# / 300# / 600# / 900# / 1500# / 2500#
--   Suppliers:       Generic fictional (ValvePro, NorthStar, Apex Flow, Meridian, Coastal Sealing)
--   Engineers:       Priya / Marcus / Helena / Diego  (Priya = default current user)
--   OM:              Sarah Lin / Tom Becker
--   Admin:           Dylan Scherman
--
-- This seed is idempotent ONLY if run against an empty database — the
-- fixed UUIDs make re-runs fail on uniqueness. To re-seed, run
--   /tables  (to see what exists)
--   DROP each user-data table  (or recreate the database)
-- then re-paste 0001 → 0002 → 0003.

------------------------------------------------------------
-- USERS — 4 engineers, 2 OM, 1 admin
------------------------------------------------------------
INSERT INTO USER (id, username, display_name, initials, role, is_admin, password_hash) VALUES
  ('20000000-0000-0000-0000-000000000001', 'praman',   'Priya Raman',    'PR', 'engineer',         0, ''),
  ('20000000-0000-0000-0000-000000000002', 'mwebb',    'Marcus Webb',    'MW', 'engineer',         0, ''),
  ('20000000-0000-0000-0000-000000000003', 'hcho',     'Helena Cho',     'HC', 'engineer',         0, ''),
  ('20000000-0000-0000-0000-000000000004', 'dortiz',   'Diego Ortiz',    'DO', 'engineer',         0, ''),
  ('20000000-0000-0000-0000-000000000005', 'slin',     'Sarah Lin',      'SL', 'order_management', 0, ''),
  ('20000000-0000-0000-0000-000000000006', 'tbecker',  'Tom Becker',     'TB', 'order_management', 0, ''),
  ('20000000-0000-0000-0000-000000000007', 'dscherman','Dylan Scherman', 'DS', 'engineer',         1, '');

UPDATE USER SET created_by_user_id = '20000000-0000-0000-0000-000000000007'
  WHERE id LIKE '20000000-%' AND id <> '20000000-0000-0000-0000-000000000007';

------------------------------------------------------------
-- TAGS (non-system) — spec / general / variant / cost / sell
------------------------------------------------------------
INSERT INTO TAG (id, name, name_lower, kind) VALUES
  -- spec kind (apply to SPEC)
  ('11000000-0000-0000-0000-000000000101', 'oil-and-gas',     'oil-and-gas',     'spec'),
  ('11000000-0000-0000-0000-000000000102', 'water-treatment', 'water-treatment', 'spec'),
  ('11000000-0000-0000-0000-000000000103', 'gas-processing',  'gas-processing',  'spec'),
  ('11000000-0000-0000-0000-000000000104', 'ball-valve',      'ball-valve',      'spec'),
  ('11000000-0000-0000-0000-000000000105', 'gate-valve',      'gate-valve',      'spec'),
  ('11000000-0000-0000-0000-000000000106', 'check-valve',     'check-valve',     'spec'),
  ('11000000-0000-0000-0000-000000000107', 'api-6d',          'api-6d',          'spec'),
  ('11000000-0000-0000-0000-000000000108', 'nace-mr0175',     'nace-mr0175',     'spec'),
  -- general kind (apply to STRUCTURE)
  ('11000000-0000-0000-0000-000000000201', 'firesafe',        'firesafe',        'general'),
  ('11000000-0000-0000-0000-000000000202', 'class-150',       'class-150',       'general'),
  ('11000000-0000-0000-0000-000000000203', 'class-300',       'class-300',       'general'),
  ('11000000-0000-0000-0000-000000000204', 'class-600',       'class-600',       'general'),
  ('11000000-0000-0000-0000-000000000205', 'class-900',       'class-900',       'general'),
  ('11000000-0000-0000-0000-000000000206', 'bidirectional',   'bidirectional',   'general'),
  -- variant kind (apply to variant STRUCTUREs only)
  ('11000000-0000-0000-0000-000000000301', 'arctic',          'arctic',          'variant'),
  ('11000000-0000-0000-0000-000000000302', 'marine',          'marine',          'variant'),
  ('11000000-0000-0000-0000-000000000303', 'hazardous-area',  'hazardous-area',  'variant'),
  -- cost kind (apply to component_cost / subassembly_cost PPs)
  ('11000000-0000-0000-0000-000000000401', 'cost-2026',          'cost-2026',          'cost'),
  ('11000000-0000-0000-0000-000000000402', 'lta-valvepro-2026',  'lta-valvepro-2026',  'cost'),
  -- sell kind (apply to structure_sell PPs)
  ('11000000-0000-0000-0000-000000000501', 'sell-2026',       'sell-2026',       'sell');

------------------------------------------------------------
-- SPECs — 3 across ball/gate/check, randomized 3-digit prefixes
------------------------------------------------------------
INSERT INTO SPEC (id, spec_number, customer_revision, created_by_user_id, created_at) VALUES
  ('30000000-0000-0000-0000-000000000001', '217T4501', 'Rev 3', '20000000-0000-0000-0000-000000000001', '2023-02-14T09:12:00Z'),
  ('30000000-0000-0000-0000-000000000002', '308T2210', 'Rev 1', '20000000-0000-0000-0000-000000000003', '2025-09-12T14:08:00Z'),
  ('30000000-0000-0000-0000-000000000003', '442T0925', 'Rev 2', '20000000-0000-0000-0000-000000000004', '2024-04-30T11:25:00Z');

------------------------------------------------------------
-- SPEC_REVISIONs (history of customer-issued rev)
-- Spec 1 has 3 revs (mature spec); Spec 2 has 1; Spec 3 has 2
------------------------------------------------------------
INSERT INTO SPEC_REVISION (id, spec_id, customer_revision, author_user_id, recorded_at, notes, change_set) VALUES
  -- Spec 1 — 217T4501 — Rev 1 → Rev 2 → Rev 3
  ('31000000-0000-0000-0000-000000000101', '30000000-0000-0000-0000-000000000001', 'Rev 1', '20000000-0000-0000-0000-000000000001', '2023-02-14T09:12:00Z', 'Initial spec release from customer.',                                  '{"customer_revision":{"old":null,"new":"Rev 1"},"tags":{"added":[]}}'),
  ('31000000-0000-0000-0000-000000000102', '30000000-0000-0000-0000-000000000001', 'Rev 2', '20000000-0000-0000-0000-000000000002', '2024-08-22T15:43:00Z', 'Customer added firesafe requirement; updated seat material spec.',     '{"customer_revision":{"old":"Rev 1","new":"Rev 2"},"tags":{"added":[]}}'),
  ('31000000-0000-0000-0000-000000000103', '30000000-0000-0000-0000-000000000001', 'Rev 3', '20000000-0000-0000-0000-000000000001', '2025-11-05T10:30:00Z', 'Tightened actuator response time spec; reissued for 2026 production.', '{"customer_revision":{"old":"Rev 2","new":"Rev 3"},"tags":{"added":[]}}'),
  -- Spec 2 — 308T2210 — Rev 1 only
  ('31000000-0000-0000-0000-000000000201', '30000000-0000-0000-0000-000000000002', 'Rev 1', '20000000-0000-0000-0000-000000000003', '2025-09-12T14:08:00Z', 'New spec for municipal water expansion.',                              '{"customer_revision":{"old":null,"new":"Rev 1"},"tags":{"added":[]}}'),
  -- Spec 3 — 442T0925 — Rev 1 → Rev 2
  ('31000000-0000-0000-0000-000000000301', '30000000-0000-0000-0000-000000000003', 'Rev 1', '20000000-0000-0000-0000-000000000004', '2024-04-30T11:25:00Z', 'Initial release.',                                                     '{"customer_revision":{"old":null,"new":"Rev 1"},"tags":{"added":[]}}'),
  ('31000000-0000-0000-0000-000000000302', '30000000-0000-0000-0000-000000000003', 'Rev 2', '20000000-0000-0000-0000-000000000004', '2026-01-15T08:50:00Z', 'Added ATEX zone requirement for haz-area applications.',               '{"customer_revision":{"old":"Rev 1","new":"Rev 2"},"tags":{"added":[]}}');

------------------------------------------------------------
-- SPEC_TAGs — apply spec-kind tags
------------------------------------------------------------
INSERT INTO SPEC_TAG (spec_id, tag_id, applied_by_user_id, applied_at) VALUES
  -- 217T4501: ball valve for oil & gas, API 6D
  ('30000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000104', '20000000-0000-0000-0000-000000000001', '2023-02-14T09:13:00Z'),
  ('30000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000101', '20000000-0000-0000-0000-000000000001', '2023-02-14T09:13:00Z'),
  ('30000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000107', '20000000-0000-0000-0000-000000000001', '2023-02-14T09:13:00Z'),
  -- 308T2210: gate valve for water treatment
  ('30000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000105', '20000000-0000-0000-0000-000000000003', '2025-09-12T14:09:00Z'),
  ('30000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000102', '20000000-0000-0000-0000-000000000003', '2025-09-12T14:09:00Z'),
  -- 442T0925: check valve for gas processing, API 6D + sour-service capable
  ('30000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000106', '20000000-0000-0000-0000-000000000004', '2024-04-30T11:26:00Z'),
  ('30000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000103', '20000000-0000-0000-0000-000000000004', '2024-04-30T11:26:00Z'),
  ('30000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000107', '20000000-0000-0000-0000-000000000004', '2024-04-30T11:26:00Z'),
  ('30000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000108', '20000000-0000-0000-0000-000000000004', '2024-04-30T11:26:00Z');

------------------------------------------------------------
-- STRUCTUREs — 3 base parts + 3 hyphen-suffix variants
-- All pinned to the current SPEC_REVISION of their spec.
-- current_construction_revision_number / current_price_revision_number
-- set to 1 to reflect the CR 1 / PR 1 we insert below.
------------------------------------------------------------
INSERT INTO STRUCTURE (id, part_number, spec_id, spec_revision_id, parent_structure_id,
                       current_construction_revision_number, current_price_revision_number,
                       build_hours, target_assembly_margin_pct,
                       build_instr_1, build_instr_2, build_instr_3,
                       work_instr_1, work_instr_2,
                       created_by_user_id, created_at) VALUES
  -- Spec 1: P001 (base) + P001-ARC (arctic variant)
  ('40000000-0000-0000-0000-000000000101', 'P001',     '30000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000103', NULL,
   1, 1, 4.5, 0.35,
   'Hydrostatic test body to 1.5x rated pressure per API 598.',
   'Lap seats to bearing area >=80% before final assembly.',
   'Stroke check actuator 3 cycles minimum at line pressure.',
   'Apply blue Loctite 243 to bonnet studs.',
   'Witness shop test if customer source-inspection order is open.',
   '20000000-0000-0000-0000-000000000001', '2023-03-01T08:00:00Z'),

  ('40000000-0000-0000-0000-000000000102', 'P001-ARC', '30000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000103', '40000000-0000-0000-0000-000000000101',
   1, 1, 5.5, 0.35,
   'Cold-soak hydro per API 598 Annex F (-50 deg F minimum).',
   'Lap seats to bearing area >=80% before final assembly.',
   'Stroke check at -40 deg F per arctic-service procedure ARC-WI-012.',
   'Apply arctic-grade thread locker (Loctite 2620) to bonnet studs.',
   'Pack actuator with low-temp grease (Mobilith SHC 100).',
   '20000000-0000-0000-0000-000000000002', '2024-09-15T13:20:00Z'),

  -- Spec 2: P001 (base) + P001-MAR (marine variant)
  ('40000000-0000-0000-0000-000000000201', 'P001',     '30000000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000201', NULL,
   1, 1, 3.5, 0.32,
   'Hydrostatic test body to 1.5x rated pressure per AWWA C509.',
   'Verify wedge contact pattern before bonnet torque-down.',
   NULL,
   'Apply red Loctite 271 to wedge stem nut.',
   NULL,
   '20000000-0000-0000-0000-000000000003', '2025-09-20T10:00:00Z'),

  ('40000000-0000-0000-0000-000000000202', 'P001-MAR', '30000000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000201', '40000000-0000-0000-0000-000000000201',
   1, 1, 4.5, 0.32,
   'Hydrostatic test body to 1.5x rated pressure per AWWA C509.',
   'Verify wedge contact pattern before bonnet torque-down.',
   'Marine paint coverage: 250 micron DFT minimum across exterior.',
   'Apply red Loctite 271 to wedge stem nut.',
   'Topcoat to be applied within 48 hours of primer to meet adhesion spec.',
   '20000000-0000-0000-0000-000000000003', '2025-09-22T09:30:00Z'),

  -- Spec 3: P001 (base) + P001-HAZ (haz-area variant)
  ('40000000-0000-0000-0000-000000000301', 'P001',     '30000000-0000-0000-0000-000000000003', '31000000-0000-0000-0000-000000000302', NULL,
   1, 1, 5.0, 0.38,
   'Body hydro to 1.5x rated; seat closure test at 110% MAWP per API 6D.',
   'Verify disc swing freedom through full travel.',
   'Tighten bolting in star pattern; final torque per RTJ gasket spec.',
   'Install nameplate on body — do NOT etch the pressure-retaining wall.',
   NULL,
   '20000000-0000-0000-0000-000000000004', '2024-05-10T11:00:00Z'),

  ('40000000-0000-0000-0000-000000000302', 'P001-HAZ', '30000000-0000-0000-0000-000000000003', '31000000-0000-0000-0000-000000000302', '40000000-0000-0000-0000-000000000301',
   1, 1, 6.0, 0.38,
   'Body hydro to 1.5x rated; seat closure test at 110% MAWP per API 6D.',
   'Verify disc swing freedom through full travel.',
   'Tighten bolting in star pattern; final torque per RTJ gasket spec.',
   'Install ATEX nameplate alongside primary nameplate.',
   'Witness ATEX inspector sign-off before crate-up.',
   '20000000-0000-0000-0000-000000000004', '2024-05-12T15:45:00Z');

------------------------------------------------------------
-- STRUCTURE_TAGs — general tags + variant tags
------------------------------------------------------------
INSERT INTO STRUCTURE_TAG (structure_id, tag_id, applied_by_user_id, applied_at) VALUES
  -- 217T4501 P001 (base): firesafe + class-300
  ('40000000-0000-0000-0000-000000000101', '11000000-0000-0000-0000-000000000201', '20000000-0000-0000-0000-000000000001', '2023-03-01T08:30:00Z'),
  ('40000000-0000-0000-0000-000000000101', '11000000-0000-0000-0000-000000000203', '20000000-0000-0000-0000-000000000001', '2023-03-01T08:30:00Z'),
  -- 217T4501 P001-ARC (variant): inherits firesafe + class-300; adds arctic
  ('40000000-0000-0000-0000-000000000102', '11000000-0000-0000-0000-000000000201', '20000000-0000-0000-0000-000000000002', '2024-09-15T13:30:00Z'),
  ('40000000-0000-0000-0000-000000000102', '11000000-0000-0000-0000-000000000203', '20000000-0000-0000-0000-000000000002', '2024-09-15T13:30:00Z'),
  ('40000000-0000-0000-0000-000000000102', '11000000-0000-0000-0000-000000000301', '20000000-0000-0000-0000-000000000002', '2024-09-15T13:30:00Z'),

  -- 308T2210 P001 (base): class-150 + bidirectional
  ('40000000-0000-0000-0000-000000000201', '11000000-0000-0000-0000-000000000202', '20000000-0000-0000-0000-000000000003', '2025-09-20T10:15:00Z'),
  ('40000000-0000-0000-0000-000000000201', '11000000-0000-0000-0000-000000000206', '20000000-0000-0000-0000-000000000003', '2025-09-20T10:15:00Z'),
  -- 308T2210 P001-MAR (variant): inherits class-150 + bidirectional; adds marine
  ('40000000-0000-0000-0000-000000000202', '11000000-0000-0000-0000-000000000202', '20000000-0000-0000-0000-000000000003', '2025-09-22T09:45:00Z'),
  ('40000000-0000-0000-0000-000000000202', '11000000-0000-0000-0000-000000000206', '20000000-0000-0000-0000-000000000003', '2025-09-22T09:45:00Z'),
  ('40000000-0000-0000-0000-000000000202', '11000000-0000-0000-0000-000000000302', '20000000-0000-0000-0000-000000000003', '2025-09-22T09:45:00Z'),

  -- 442T0925 P001 (base): class-900
  ('40000000-0000-0000-0000-000000000301', '11000000-0000-0000-0000-000000000205', '20000000-0000-0000-0000-000000000004', '2024-05-10T11:15:00Z'),
  -- 442T0925 P001-HAZ (variant): inherits class-900; adds hazardous-area
  ('40000000-0000-0000-0000-000000000302', '11000000-0000-0000-0000-000000000205', '20000000-0000-0000-0000-000000000004', '2024-05-12T15:55:00Z'),
  ('40000000-0000-0000-0000-000000000302', '11000000-0000-0000-0000-000000000303', '20000000-0000-0000-0000-000000000004', '2024-05-12T15:55:00Z');

------------------------------------------------------------
-- PRICE_POINTs — component_cost rows (26 unique components)
-- Tagged cost-2026 (plus lta-valvepro-2026 on a few ValvePro items)
------------------------------------------------------------
INSERT INTO PRICE_POINT (id, component_part_number, structure_id, scope, price, quote_number, set_by_user_id, set_at) VALUES
  ('50000000-0000-0000-0000-000000000001', 'BODY-FORGED-A105',              NULL, 'component_cost',  850.00, 'Q-ValvePro-2025-0142',   '20000000-0000-0000-0000-000000000001', '2025-11-10T09:00:00Z'),
  ('50000000-0000-0000-0000-000000000002', 'BODY-FORGED-LCC',               NULL, 'component_cost', 1200.00, 'Q-ValvePro-2025-0188',   '20000000-0000-0000-0000-000000000003', '2025-11-10T09:00:00Z'),
  ('50000000-0000-0000-0000-000000000003', 'BODY-FORGED-316SS',             NULL, 'component_cost', 2400.00, 'Q-ValvePro-2025-0211',   '20000000-0000-0000-0000-000000000004', '2025-11-10T09:00:00Z'),
  ('50000000-0000-0000-0000-000000000004', 'BODY-CAST-LCC-INSULATED',       NULL, 'component_cost', 1650.00, 'Q-ValvePro-2025-0190',   '20000000-0000-0000-0000-000000000002', '2025-11-10T09:00:00Z'),
  ('50000000-0000-0000-0000-000000000005', 'BODY-FORGED-DUPLEX-2205',       NULL, 'component_cost', 3200.00, 'Q-ValvePro-2025-0250',   '20000000-0000-0000-0000-000000000003', '2025-11-10T09:00:00Z'),
  ('50000000-0000-0000-0000-000000000006', 'BODY-FORGED-INCONEL-625',       NULL, 'component_cost', 5400.00, 'Q-ValvePro-2025-0301',   '20000000-0000-0000-0000-000000000004', '2025-11-10T09:00:00Z'),
  ('50000000-0000-0000-0000-000000000007', 'SEAT-PEEK-ASB',                 NULL, 'component_cost',   85.00, 'Q-NorthStar-2025-1101',  '20000000-0000-0000-0000-000000000001', '2025-11-12T11:00:00Z'),
  ('50000000-0000-0000-0000-000000000008', 'SEAT-RPTFE-FSA',                NULL, 'component_cost',   65.00, 'Q-NorthStar-2025-1102',  '20000000-0000-0000-0000-000000000003', '2025-11-12T11:00:00Z'),
  ('50000000-0000-0000-0000-000000000009', 'SEAT-METAL-STELLITE',           NULL, 'component_cost',  420.00, 'Q-NorthStar-2025-1133',  '20000000-0000-0000-0000-000000000004', '2025-11-12T11:00:00Z'),
  ('50000000-0000-0000-0000-000000000010', 'STEM-17-4PH',                   NULL, 'component_cost',  145.00, 'Q-ApexFlow-2025-0501',   '20000000-0000-0000-0000-000000000001', '2025-11-14T14:00:00Z'),
  ('50000000-0000-0000-0000-000000000011', 'STEM-INCONEL-625',              NULL, 'component_cost',  580.00, 'Q-ApexFlow-2025-0511',   '20000000-0000-0000-0000-000000000003', '2025-11-14T14:00:00Z'),
  ('50000000-0000-0000-0000-000000000012', 'BALL-CHROME-PLATED-A105',       NULL, 'component_cost',  310.00, 'Q-Meridian-2025-3014',   '20000000-0000-0000-0000-000000000001', '2025-11-15T10:30:00Z'),
  ('50000000-0000-0000-0000-000000000013', 'GATE-WEDGE-13CR',               NULL, 'component_cost',  410.00, 'Q-Meridian-2025-3022',   '20000000-0000-0000-0000-000000000003', '2025-11-15T10:30:00Z'),
  ('50000000-0000-0000-0000-000000000014', 'DISC-NICKEL-ALUMINUM-BRONZE',   NULL, 'component_cost',  260.00, 'Q-Meridian-2025-3041',   '20000000-0000-0000-0000-000000000004', '2025-11-15T10:30:00Z'),
  ('50000000-0000-0000-0000-000000000015', 'ACTUATOR-PNEUMATIC-DA',         NULL, 'component_cost', 1850.00, 'Q-ValvePro-2025-LTA-77', '20000000-0000-0000-0000-000000000001', '2025-12-01T08:00:00Z'),
  ('50000000-0000-0000-0000-000000000016', 'BOLTS-B7-1IN',                  NULL, 'component_cost',    4.50, 'Q-Meridian-2025-9001',   '20000000-0000-0000-0000-000000000004', '2025-11-20T16:00:00Z'),
  ('50000000-0000-0000-0000-000000000017', 'BOLTS-B7M-NACE-3-4IN',          NULL, 'component_cost',    6.20, 'Q-Meridian-2025-9012',   '20000000-0000-0000-0000-000000000004', '2025-11-20T16:00:00Z'),
  ('50000000-0000-0000-0000-000000000018', 'NUTS-2H-1IN',                   NULL, 'component_cost',    1.85, 'Q-Meridian-2025-9020',   '20000000-0000-0000-0000-000000000004', '2025-11-20T16:00:00Z'),
  ('50000000-0000-0000-0000-000000000019', 'GASKET-SPIRAL-WOUND-316',       NULL, 'component_cost',   28.00, 'Q-Coastal-2025-0440',    '20000000-0000-0000-0000-000000000001', '2025-11-18T12:00:00Z'),
  ('50000000-0000-0000-0000-000000000020', 'GASKET-RTJ-OCTAGONAL-R45',      NULL, 'component_cost',   42.00, 'Q-Coastal-2025-0461',    '20000000-0000-0000-0000-000000000004', '2025-11-18T12:00:00Z'),
  ('50000000-0000-0000-0000-000000000021', 'PACKING-GRAPHITE-V-RING',       NULL, 'component_cost',   48.00, 'Q-Coastal-2025-0482',    '20000000-0000-0000-0000-000000000003', '2025-11-18T12:00:00Z'),
  ('50000000-0000-0000-0000-000000000022', 'HANDWHEEL-CARBON-12IN',         NULL, 'component_cost',   95.00, 'Q-Meridian-2025-7010',   '20000000-0000-0000-0000-000000000003', '2025-11-22T09:00:00Z'),
  ('50000000-0000-0000-0000-000000000023', 'NAMEPLATE-SS-LASER',            NULL, 'component_cost',   12.00, 'Q-Meridian-2025-8050',   '20000000-0000-0000-0000-000000000001', '2025-11-22T09:00:00Z'),
  ('50000000-0000-0000-0000-000000000024', 'PAINT-EPOXY-ARCTIC-WHITE',      NULL, 'component_cost',  145.00, 'Q-ApexFlow-2025-0701',   '20000000-0000-0000-0000-000000000002', '2025-11-25T15:00:00Z'),
  ('50000000-0000-0000-0000-000000000025', 'PAINT-MARINE-EPOXY-RAL5005',    NULL, 'component_cost',  165.00, 'Q-ApexFlow-2025-0711',   '20000000-0000-0000-0000-000000000003', '2025-11-25T15:00:00Z'),
  ('50000000-0000-0000-0000-000000000026', 'CERTIFICATE-ATEX-EXII2G',       NULL, 'component_cost',  320.00, 'Q-Meridian-2025-8201',   '20000000-0000-0000-0000-000000000004', '2025-12-03T10:00:00Z');

-- Tag every component_cost PP with cost-2026
INSERT INTO PRICE_POINT_TAG (price_point_id, tag_id, applied_by_user_id, applied_at)
SELECT pp.id, '11000000-0000-0000-0000-000000000401', pp.set_by_user_id, pp.set_at
FROM PRICE_POINT pp
WHERE pp.scope = 'component_cost';

-- ValvePro bodies + the actuator also carry the lta-valvepro-2026 tag
INSERT INTO PRICE_POINT_TAG (price_point_id, tag_id, applied_by_user_id, applied_at) VALUES
  ('50000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000402', '20000000-0000-0000-0000-000000000001', '2025-11-10T09:00:00Z'),
  ('50000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000402', '20000000-0000-0000-0000-000000000003', '2025-11-10T09:00:00Z'),
  ('50000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000402', '20000000-0000-0000-0000-000000000004', '2025-11-10T09:00:00Z'),
  ('50000000-0000-0000-0000-000000000004', '11000000-0000-0000-0000-000000000402', '20000000-0000-0000-0000-000000000002', '2025-11-10T09:00:00Z'),
  ('50000000-0000-0000-0000-000000000005', '11000000-0000-0000-0000-000000000402', '20000000-0000-0000-0000-000000000003', '2025-11-10T09:00:00Z'),
  ('50000000-0000-0000-0000-000000000006', '11000000-0000-0000-0000-000000000402', '20000000-0000-0000-0000-000000000004', '2025-11-10T09:00:00Z'),
  ('50000000-0000-0000-0000-000000000015', '11000000-0000-0000-0000-000000000402', '20000000-0000-0000-0000-000000000001', '2025-12-01T08:00:00Z');

------------------------------------------------------------
-- CONSTRUCTION_REVISIONs (CR 1 per structure)
-- change_set is structured-ish JSON sketching what the initial commit covered.
------------------------------------------------------------
INSERT INTO CONSTRUCTION_REVISION (id, structure_id, revision_number, author_user_id, committed_at, change_set, notes) VALUES
  ('41000000-0000-0000-0000-000000000101', '40000000-0000-0000-0000-000000000101', 1, '20000000-0000-0000-0000-000000000001', '2023-03-01T17:15:00Z', '{"structure_fields":{"note":"initial CR — base part"},"line_items":{"added":7},"tags":{"added":["firesafe","class-300"]}}', 'Initial release. Pinned to spec 217T4501 Rev 1.'),
  ('41000000-0000-0000-0000-000000000102', '40000000-0000-0000-0000-000000000102', 1, '20000000-0000-0000-0000-000000000002', '2024-09-15T18:00:00Z', '{"structure_fields":{"note":"initial CR — arctic variant of P001"},"line_items":{"added":7},"tags":{"added":["firesafe","class-300","arctic"]}}', 'Arctic variant spawned from P001 for the North Slope project. Body swapped to insulated cast LCC.'),
  ('41000000-0000-0000-0000-000000000201', '40000000-0000-0000-0000-000000000201', 1, '20000000-0000-0000-0000-000000000003', '2025-09-20T16:40:00Z', '{"structure_fields":{"note":"initial CR — base part"},"line_items":{"added":7},"tags":{"added":["class-150","bidirectional"]}}', 'Initial release for Marrickville water treatment expansion.'),
  ('41000000-0000-0000-0000-000000000202', '40000000-0000-0000-0000-000000000202', 1, '20000000-0000-0000-0000-000000000003', '2025-09-22T15:10:00Z', '{"structure_fields":{"note":"initial CR — marine variant of P001"},"line_items":{"added":7},"tags":{"added":["class-150","bidirectional","marine"]}}', 'Marine variant for the desal pretreatment skids. Duplex body + Inconel stem to tolerate brine.'),
  ('41000000-0000-0000-0000-000000000301', '40000000-0000-0000-0000-000000000301', 1, '20000000-0000-0000-0000-000000000004', '2024-05-10T16:50:00Z', '{"structure_fields":{"note":"initial CR — base part"},"line_items":{"added":7},"tags":{"added":["class-900"]}}', 'Initial release.'),
  ('41000000-0000-0000-0000-000000000302', '40000000-0000-0000-0000-000000000302', 1, '20000000-0000-0000-0000-000000000004', '2024-05-12T17:25:00Z', '{"structure_fields":{"note":"initial CR — haz-area variant of P001"},"line_items":{"added":7},"tags":{"added":["class-900","hazardous-area"]}}', 'ATEX-certified variant. Inconel body and ATEX cert per customer Zone 1 spec.');

------------------------------------------------------------
-- PRICE_REVISIONs (PR 1 per structure)
------------------------------------------------------------
INSERT INTO PRICE_REVISION (id, structure_id, revision_number, author_user_id, committed_at, change_set, notes) VALUES
  ('42000000-0000-0000-0000-000000000101', '40000000-0000-0000-0000-000000000101', 1, '20000000-0000-0000-0000-000000000001', '2023-03-01T17:15:00Z', '{"line_items":{"priced":7,"commissioned":1},"structure_fields":{"target_assembly_margin_pct":"0.35"}}', NULL),
  ('42000000-0000-0000-0000-000000000102', '40000000-0000-0000-0000-000000000102', 1, '20000000-0000-0000-0000-000000000002', '2024-09-15T18:00:00Z', '{"line_items":{"priced":7,"commissioned":1},"structure_fields":{"target_assembly_margin_pct":"0.35"}}', NULL),
  ('42000000-0000-0000-0000-000000000201', '40000000-0000-0000-0000-000000000201', 1, '20000000-0000-0000-0000-000000000003', '2025-09-20T16:40:00Z', '{"line_items":{"priced":7,"commissioned":0},"structure_fields":{"target_assembly_margin_pct":"0.32"}}', NULL),
  ('42000000-0000-0000-0000-000000000202', '40000000-0000-0000-0000-000000000202', 1, '20000000-0000-0000-0000-000000000003', '2025-09-22T15:10:00Z', '{"line_items":{"priced":7,"commissioned":0},"structure_fields":{"target_assembly_margin_pct":"0.32"}}', NULL),
  ('42000000-0000-0000-0000-000000000301', '40000000-0000-0000-0000-000000000301', 1, '20000000-0000-0000-0000-000000000004', '2024-05-10T16:50:00Z', '{"line_items":{"priced":7,"commissioned":0},"structure_fields":{"target_assembly_margin_pct":"0.38"}}', NULL),
  ('42000000-0000-0000-0000-000000000302', '40000000-0000-0000-0000-000000000302', 1, '20000000-0000-0000-0000-000000000004', '2024-05-12T17:25:00Z', '{"line_items":{"priced":7,"commissioned":0},"structure_fields":{"target_assembly_margin_pct":"0.38"}}', NULL);

------------------------------------------------------------
-- LINE_ITEMs — 7 per structure × 6 structures = 42 rows
-- chosen_price_point_id points at the matching component_cost PP
-- (component_part_number must match exactly — schema enforces).
-- ACTUATOR-PNEUMATIC-DA lines are commissioned at 5% cap.
------------------------------------------------------------

-- Structure 101: 217T4501 P001 (ball valve, base)
INSERT INTO LINE_ITEM (id, structure_id, sort_order, component_part_number, part_description, quantity, chosen_price_point_id, supplier, lead_time_days, product_code, is_commissioned, commission_cap_pct) VALUES
  ('43000000-0000-0000-0000-101000000001', '40000000-0000-0000-0000-000000000101', 1, 'BODY-FORGED-A105',         '6" 300# RF A105 forged body', 1, '50000000-0000-0000-0000-000000000001', 'ValvePro Inc.',     45, 'VP-BD-A105-300-6',   0, NULL),
  ('43000000-0000-0000-0000-101000000002', '40000000-0000-0000-0000-000000000101', 2, 'SEAT-PEEK-ASB',            'Anti-static PEEK seat ring, ball valve', 2, '50000000-0000-0000-0000-000000000007', 'NorthStar Valves',  21, 'NS-ST-PK-ASB-6',     0, NULL),
  ('43000000-0000-0000-0000-101000000003', '40000000-0000-0000-0000-000000000101', 3, 'STEM-17-4PH',              '17-4PH stainless stem, anti-blowout',  1, '50000000-0000-0000-0000-000000000010', 'Apex Flow',         28, 'AF-STM-174-6',       0, NULL),
  ('43000000-0000-0000-0000-101000000004', '40000000-0000-0000-0000-000000000101', 4, 'BALL-CHROME-PLATED-A105',  'Chrome-plated A105 trunnion ball',     1, '50000000-0000-0000-0000-000000000012', 'Meridian Industrial', 35, 'MI-BL-CR-A105-6',   0, NULL),
  ('43000000-0000-0000-0000-101000000005', '40000000-0000-0000-0000-000000000101', 5, 'ACTUATOR-PNEUMATIC-DA',    'Double-acting pneumatic actuator, 80psi supply', 1, '50000000-0000-0000-0000-000000000015', 'ValvePro Inc.', 60, 'VP-ACT-PN-DA-S2',   1, 0.05),
  ('43000000-0000-0000-0000-101000000006', '40000000-0000-0000-0000-000000000101', 6, 'GASKET-SPIRAL-WOUND-316',  '316SS spiral-wound, flex graphite filler, 6" 300#', 2, '50000000-0000-0000-0000-000000000019', 'Coastal Sealing Co.', 14, 'CS-GK-SW-316-6-300', 0, NULL),
  ('43000000-0000-0000-0000-101000000007', '40000000-0000-0000-0000-000000000101', 7, 'NAMEPLATE-SS-LASER',       'Laser-etched 316 nameplate per ASME B16.34', 1, '50000000-0000-0000-0000-000000000023', 'Meridian Industrial', 10, 'MI-NP-SS-LSR', 0, NULL);

-- Structure 102: 217T4501 P001-ARC (arctic variant)
INSERT INTO LINE_ITEM (id, structure_id, sort_order, component_part_number, part_description, quantity, chosen_price_point_id, supplier, lead_time_days, product_code, is_commissioned, commission_cap_pct) VALUES
  ('43000000-0000-0000-0000-102000000001', '40000000-0000-0000-0000-000000000102', 1, 'BODY-CAST-LCC-INSULATED',  '6" 300# RF LCC cast body with insulation jacket, -50F service', 1, '50000000-0000-0000-0000-000000000004', 'ValvePro Inc.',     55, 'VP-BD-LCC-INS-300-6',  0, NULL),
  ('43000000-0000-0000-0000-102000000002', '40000000-0000-0000-0000-000000000102', 2, 'SEAT-PEEK-ASB',            'Anti-static PEEK seat ring, ball valve',                        2, '50000000-0000-0000-0000-000000000007', 'NorthStar Valves',  21, 'NS-ST-PK-ASB-6',       0, NULL),
  ('43000000-0000-0000-0000-102000000003', '40000000-0000-0000-0000-000000000102', 3, 'STEM-17-4PH',              '17-4PH stainless stem, anti-blowout',                            1, '50000000-0000-0000-0000-000000000010', 'Apex Flow',         28, 'AF-STM-174-6',         0, NULL),
  ('43000000-0000-0000-0000-102000000004', '40000000-0000-0000-0000-000000000102', 4, 'BALL-CHROME-PLATED-A105',  'Chrome-plated A105 trunnion ball',                               1, '50000000-0000-0000-0000-000000000012', 'Meridian Industrial', 35, 'MI-BL-CR-A105-6',     0, NULL),
  ('43000000-0000-0000-0000-102000000005', '40000000-0000-0000-0000-000000000102', 5, 'ACTUATOR-PNEUMATIC-DA',    'Double-acting pneumatic actuator, 80psi supply',                 1, '50000000-0000-0000-0000-000000000015', 'ValvePro Inc.',     60, 'VP-ACT-PN-DA-S2',      1, 0.05),
  ('43000000-0000-0000-0000-102000000006', '40000000-0000-0000-0000-000000000102', 6, 'GASKET-SPIRAL-WOUND-316',  '316SS spiral-wound, flex graphite filler, 6" 300#',              2, '50000000-0000-0000-0000-000000000019', 'Coastal Sealing Co.', 14, 'CS-GK-SW-316-6-300',  0, NULL),
  ('43000000-0000-0000-0000-102000000007', '40000000-0000-0000-0000-000000000102', 7, 'PAINT-EPOXY-ARCTIC-WHITE', 'Arctic-white epoxy topcoat per ISO 12944 C4-H',                  1, '50000000-0000-0000-0000-000000000024', 'Apex Flow',         18, 'AF-PT-AR-WHT-5L',      0, NULL);

-- Structure 201: 308T2210 P001 (gate valve, base)
INSERT INTO LINE_ITEM (id, structure_id, sort_order, component_part_number, part_description, quantity, chosen_price_point_id, supplier, lead_time_days, product_code, is_commissioned, commission_cap_pct) VALUES
  ('43000000-0000-0000-0000-201000000001', '40000000-0000-0000-0000-000000000201', 1, 'BODY-FORGED-LCC',           '8" 150# RF LCC forged body',                                    1, '50000000-0000-0000-0000-000000000002', 'ValvePro Inc.',     40, 'VP-BD-LCC-150-8',      0, NULL),
  ('43000000-0000-0000-0000-201000000002', '40000000-0000-0000-0000-000000000201', 2, 'SEAT-RPTFE-FSA',            'Reinforced PTFE seat ring, fire-safe assembly',                  2, '50000000-0000-0000-0000-000000000008', 'NorthStar Valves',  18, 'NS-ST-RPTFE-FSA-8',    0, NULL),
  ('43000000-0000-0000-0000-201000000003', '40000000-0000-0000-0000-000000000201', 3, 'STEM-17-4PH',               '17-4PH stainless stem, anti-blowout',                            1, '50000000-0000-0000-0000-000000000010', 'Apex Flow',         28, 'AF-STM-174-8',         0, NULL),
  ('43000000-0000-0000-0000-201000000004', '40000000-0000-0000-0000-000000000201', 4, 'GATE-WEDGE-13CR',           '13CR flexible wedge, solid construction',                        1, '50000000-0000-0000-0000-000000000013', 'Meridian Industrial', 30, 'MI-GW-13CR-8',         0, NULL),
  ('43000000-0000-0000-0000-201000000005', '40000000-0000-0000-0000-000000000201', 5, 'HANDWHEEL-CARBON-12IN',     'Carbon steel handwheel, 12" diameter',                           1, '50000000-0000-0000-0000-000000000022', 'Meridian Industrial', 10, 'MI-HW-CS-12',          0, NULL),
  ('43000000-0000-0000-0000-201000000006', '40000000-0000-0000-0000-000000000201', 6, 'PACKING-GRAPHITE-V-RING',   'Flexible graphite V-ring packing set',                           1, '50000000-0000-0000-0000-000000000021', 'Coastal Sealing Co.', 14, 'CS-PK-GR-V-8',         0, NULL),
  ('43000000-0000-0000-0000-201000000007', '40000000-0000-0000-0000-000000000201', 7, 'GASKET-SPIRAL-WOUND-316',   '316SS spiral-wound, flex graphite filler, 8" 150#',              2, '50000000-0000-0000-0000-000000000019', 'Coastal Sealing Co.', 14, 'CS-GK-SW-316-8-150',   0, NULL);

-- Structure 202: 308T2210 P001-MAR (marine variant)
INSERT INTO LINE_ITEM (id, structure_id, sort_order, component_part_number, part_description, quantity, chosen_price_point_id, supplier, lead_time_days, product_code, is_commissioned, commission_cap_pct) VALUES
  ('43000000-0000-0000-0000-202000000001', '40000000-0000-0000-0000-000000000202', 1, 'BODY-FORGED-DUPLEX-2205',   '8" 150# RF Duplex 2205 forged body',                             1, '50000000-0000-0000-0000-000000000005', 'ValvePro Inc.',     55, 'VP-BD-DUP-150-8',      0, NULL),
  ('43000000-0000-0000-0000-202000000002', '40000000-0000-0000-0000-000000000202', 2, 'SEAT-RPTFE-FSA',            'Reinforced PTFE seat ring, fire-safe assembly',                  2, '50000000-0000-0000-0000-000000000008', 'NorthStar Valves',  18, 'NS-ST-RPTFE-FSA-8',    0, NULL),
  ('43000000-0000-0000-0000-202000000003', '40000000-0000-0000-0000-000000000202', 3, 'STEM-INCONEL-625',          'Inconel 625 stem, marine-grade',                                 1, '50000000-0000-0000-0000-000000000011', 'Apex Flow',         42, 'AF-STM-IN625-8',       0, NULL),
  ('43000000-0000-0000-0000-202000000004', '40000000-0000-0000-0000-000000000202', 4, 'GATE-WEDGE-13CR',           '13CR flexible wedge, solid construction',                        1, '50000000-0000-0000-0000-000000000013', 'Meridian Industrial', 30, 'MI-GW-13CR-8',         0, NULL),
  ('43000000-0000-0000-0000-202000000005', '40000000-0000-0000-0000-000000000202', 5, 'HANDWHEEL-CARBON-12IN',     'Carbon steel handwheel, 12" diameter',                           1, '50000000-0000-0000-0000-000000000022', 'Meridian Industrial', 10, 'MI-HW-CS-12',          0, NULL),
  ('43000000-0000-0000-0000-202000000006', '40000000-0000-0000-0000-000000000202', 6, 'PACKING-GRAPHITE-V-RING',   'Flexible graphite V-ring packing set',                           1, '50000000-0000-0000-0000-000000000021', 'Coastal Sealing Co.', 14, 'CS-PK-GR-V-8',         0, NULL),
  ('43000000-0000-0000-0000-202000000007', '40000000-0000-0000-0000-000000000202', 7, 'PAINT-MARINE-EPOXY-RAL5005','Marine epoxy topcoat, RAL 5005 signal blue',                     1, '50000000-0000-0000-0000-000000000025', 'Apex Flow',         18, 'AF-PT-MAR-5005-5L',    0, NULL);

-- Structure 301: 442T0925 P001 (check valve, base)
INSERT INTO LINE_ITEM (id, structure_id, sort_order, component_part_number, part_description, quantity, chosen_price_point_id, supplier, lead_time_days, product_code, is_commissioned, commission_cap_pct) VALUES
  ('43000000-0000-0000-0000-301000000001', '40000000-0000-0000-0000-000000000301', 1, 'BODY-FORGED-316SS',            '4" 900# RTJ 316SS forged body',                                  1, '50000000-0000-0000-0000-000000000003', 'ValvePro Inc.',     50, 'VP-BD-316SS-900-4',   0, NULL),
  ('43000000-0000-0000-0000-301000000002', '40000000-0000-0000-0000-000000000301', 2, 'SEAT-METAL-STELLITE',           'Stellite 6 hardfaced metal seat',                                1, '50000000-0000-0000-0000-000000000009', 'NorthStar Valves',  35, 'NS-ST-MT-ST6-4',      0, NULL),
  ('43000000-0000-0000-0000-301000000003', '40000000-0000-0000-0000-000000000301', 3, 'DISC-NICKEL-ALUMINUM-BRONZE',   'NAB-625 swing-check disc',                                       1, '50000000-0000-0000-0000-000000000014', 'Apex Flow',         32, 'AF-DSC-NAB-4',        0, NULL),
  ('43000000-0000-0000-0000-301000000004', '40000000-0000-0000-0000-000000000301', 4, 'GASKET-RTJ-OCTAGONAL-R45',      'RTJ octagonal gasket, soft iron, R45',                           2, '50000000-0000-0000-0000-000000000020', 'Coastal Sealing Co.', 14, 'CS-GK-RTJ-R45-SI',    0, NULL),
  ('43000000-0000-0000-0000-301000000005', '40000000-0000-0000-0000-000000000301', 5, 'BOLTS-B7-1IN',                  'B7 studs, 1" diameter, 7" effective length',                    16, '50000000-0000-0000-0000-000000000016', 'Meridian Industrial',  7, 'MI-BL-B7-1-7',        0, NULL),
  ('43000000-0000-0000-0000-301000000006', '40000000-0000-0000-0000-000000000301', 6, 'NUTS-2H-1IN',                   '2H heavy-hex nuts, 1" diameter',                                16, '50000000-0000-0000-0000-000000000018', 'Meridian Industrial',  7, 'MI-NT-2H-1',          0, NULL),
  ('43000000-0000-0000-0000-301000000007', '40000000-0000-0000-0000-000000000301', 7, 'NAMEPLATE-SS-LASER',            'Laser-etched 316 nameplate per ASME B16.34',                      1, '50000000-0000-0000-0000-000000000023', 'Meridian Industrial', 10, 'MI-NP-SS-LSR',        0, NULL);

-- Structure 302: 442T0925 P001-HAZ (haz-area variant)
INSERT INTO LINE_ITEM (id, structure_id, sort_order, component_part_number, part_description, quantity, chosen_price_point_id, supplier, lead_time_days, product_code, is_commissioned, commission_cap_pct) VALUES
  ('43000000-0000-0000-0000-302000000001', '40000000-0000-0000-0000-000000000302', 1, 'BODY-FORGED-INCONEL-625',       '4" 900# RTJ Inconel 625 forged body, ATEX',                       1, '50000000-0000-0000-0000-000000000006', 'ValvePro Inc.',     70, 'VP-BD-IN625-900-4-ATEX', 0, NULL),
  ('43000000-0000-0000-0000-302000000002', '40000000-0000-0000-0000-000000000302', 2, 'SEAT-METAL-STELLITE',           'Stellite 6 hardfaced metal seat',                                1, '50000000-0000-0000-0000-000000000009', 'NorthStar Valves',  35, 'NS-ST-MT-ST6-4',         0, NULL),
  ('43000000-0000-0000-0000-302000000003', '40000000-0000-0000-0000-000000000302', 3, 'DISC-NICKEL-ALUMINUM-BRONZE',   'NAB-625 swing-check disc',                                       1, '50000000-0000-0000-0000-000000000014', 'Apex Flow',         32, 'AF-DSC-NAB-4',           0, NULL),
  ('43000000-0000-0000-0000-302000000004', '40000000-0000-0000-0000-000000000302', 4, 'GASKET-RTJ-OCTAGONAL-R45',      'RTJ octagonal gasket, soft iron, R45',                           2, '50000000-0000-0000-0000-000000000020', 'Coastal Sealing Co.', 14, 'CS-GK-RTJ-R45-SI',       0, NULL),
  ('43000000-0000-0000-0000-302000000005', '40000000-0000-0000-0000-000000000302', 5, 'BOLTS-B7M-NACE-3-4IN',          'B7M NACE MR0175 studs, 3/4" diameter',                          16, '50000000-0000-0000-0000-000000000017', 'Meridian Industrial', 10, 'MI-BL-B7M-NACE-34',      0, NULL),
  ('43000000-0000-0000-0000-302000000006', '40000000-0000-0000-0000-000000000302', 6, 'NUTS-2H-1IN',                   '2H heavy-hex nuts, 1" diameter',                                16, '50000000-0000-0000-0000-000000000018', 'Meridian Industrial',  7, 'MI-NT-2H-1',             0, NULL),
  ('43000000-0000-0000-0000-302000000007', '40000000-0000-0000-0000-000000000302', 7, 'CERTIFICATE-ATEX-EXII2G',       'ATEX cert package, Zone 1 IIB T4 Gb',                            1, '50000000-0000-0000-0000-000000000026', 'Meridian Industrial', 14, 'MI-CT-ATEX-IIB-T4',      0, NULL);

------------------------------------------------------------
-- PRICE_POINTs — structure_sell rows (one per structure, sell-2026)
-- Carry (CR, PR) provenance for click-through traceability.
-- Prices computed via Σ(cost × qty) / (1 − target_margin); commissioned
-- redistribution will be exact when the Phase 4 back-solve lands.
------------------------------------------------------------
INSERT INTO PRICE_POINT (id, component_part_number, structure_id, scope, price, quote_number,
                         derived_from_construction_revision_id, derived_from_price_revision_id,
                         set_by_user_id, set_at) VALUES
  ('50000000-0000-0000-0000-000000000101', NULL, '40000000-0000-0000-0000-000000000101', 'structure_sell',  5220.00, NULL, '41000000-0000-0000-0000-000000000101', '42000000-0000-0000-0000-000000000101', '20000000-0000-0000-0000-000000000001', '2023-03-01T17:15:00Z'),
  ('50000000-0000-0000-0000-000000000102', NULL, '40000000-0000-0000-0000-000000000102', 'structure_sell',  6655.00, NULL, '41000000-0000-0000-0000-000000000102', '42000000-0000-0000-0000-000000000102', '20000000-0000-0000-0000-000000000002', '2024-09-15T18:00:00Z'),
  ('50000000-0000-0000-0000-000000000201', NULL, '40000000-0000-0000-0000-000000000201', 'structure_sell',  3206.00, NULL, '41000000-0000-0000-0000-000000000201', '42000000-0000-0000-0000-000000000201', '20000000-0000-0000-0000-000000000003', '2025-09-20T16:40:00Z'),
  ('50000000-0000-0000-0000-000000000202', NULL, '40000000-0000-0000-0000-000000000202', 'structure_sell',  7120.00, NULL, '41000000-0000-0000-0000-000000000202', '42000000-0000-0000-0000-000000000202', '20000000-0000-0000-0000-000000000003', '2025-09-22T15:10:00Z'),
  ('50000000-0000-0000-0000-000000000301', NULL, '40000000-0000-0000-0000-000000000301', 'structure_sell',  5042.00, NULL, '41000000-0000-0000-0000-000000000301', '42000000-0000-0000-0000-000000000301', '20000000-0000-0000-0000-000000000004', '2024-05-10T16:50:00Z'),
  ('50000000-0000-0000-0000-000000000302', NULL, '40000000-0000-0000-0000-000000000302', 'structure_sell', 10174.00, NULL, '41000000-0000-0000-0000-000000000302', '42000000-0000-0000-0000-000000000302', '20000000-0000-0000-0000-000000000004', '2024-05-12T17:25:00Z');

-- Tag every structure_sell PP with sell-2026
INSERT INTO PRICE_POINT_TAG (price_point_id, tag_id, applied_by_user_id, applied_at)
SELECT pp.id, '11000000-0000-0000-0000-000000000501', pp.set_by_user_id, pp.set_at
FROM PRICE_POINT pp
WHERE pp.scope = 'structure_sell';
