-- ============================================================================
-- FORGE ERP  ·  Forge Town Works — manufacturing execution & plant maintenance
-- ----------------------------------------------------------------------------
-- Real-world analog: SAP ERP (PP/PM modules) + an MES historian, ISA-95 style:
--   plants           ~ SAP plant master (T001W)
--   machines         ~ equipment / work centers (PM equipment records)
--   work_orders      ~ production orders (AUFK/AFKO): product, qty, status, due
--   sensor_readings  ~ MES/SCADA historian tags (one row per metric sample)
--   maintenance_log  ~ PM notifications (M1/M2): event + severity
--
-- STORY (diegetic dev note):
--   Forge Town's plant is failing and nobody on the floor can say why. The
--   answer is in the data: ONE machine (2104, Extruder Line 2) has a cooked
--   main-screw bearing — overdue maintenance, climbing bearing_temp, vibration
--   off the chart — and every blocked work order in the plant traces back to
--   it. The boss encounter is a diagnosis. A sensible join solves it, e.g.:
--     SELECT m.name, s.metric, s.value, s.unit
--       FROM machines m JOIN sensor_readings s ON s.machine_id = m.machine_id
--      WHERE s.metric = 'bearing_temp' AND s.value > 100;
--   ...or follow the blocked work_orders back to their machine_id.
--   (Careful: the furnace runs at 1462 C and is perfectly healthy. Filter by
--   metric, not by raw value — that is the point.)
-- ============================================================================

PRAGMA foreign_keys = OFF;  -- declared for joins, unenforced (see aster_hr.sql)

CREATE TABLE plants (
  plant_id INTEGER PRIMARY KEY,
  name     TEXT NOT NULL,
  status   TEXT NOT NULL               -- operational | degraded | offline
);

CREATE TABLE machines (
  machine_id INTEGER PRIMARY KEY,
  plant_id   INTEGER NOT NULL REFERENCES plants(plant_id),
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,            -- furnace | mill | extruder | cnc | conveyor | treatment | stepper | bonder
  status     TEXT NOT NULL             -- running | idle | fault
);

CREATE TABLE work_orders (
  wo_id      INTEGER PRIMARY KEY,
  plant_id   INTEGER NOT NULL REFERENCES plants(plant_id),
  machine_id INTEGER REFERENCES machines(machine_id),
  product    TEXT NOT NULL,
  qty        INTEGER NOT NULL,
  status     TEXT NOT NULL,            -- created | released | in_progress | blocked | completed
  due_date   TEXT NOT NULL             -- ISO date; "today" in Forge Town is 2189-06-10
);

CREATE TABLE sensor_readings (
  reading_id INTEGER PRIMARY KEY,
  machine_id INTEGER NOT NULL REFERENCES machines(machine_id),
  ts         TEXT NOT NULL,            -- 'YYYY-MM-DD HH:MM:SS'
  metric     TEXT NOT NULL,            -- bearing_temp | vibration_rms | core_temp | ...
  value      REAL NOT NULL,
  unit       TEXT NOT NULL
);

CREATE TABLE maintenance_log (
  log_id     INTEGER PRIMARY KEY,
  machine_id INTEGER NOT NULL REFERENCES machines(machine_id),
  ts         TEXT NOT NULL,
  event      TEXT NOT NULL,
  severity   TEXT NOT NULL             -- info | warning | critical
);

-- ===========================================================================
-- SEED DATA  (deterministic)
-- ===========================================================================

INSERT INTO plants (plant_id, name, status) VALUES
  (1, 'Forge Town Works No.3', 'degraded'),
  (2, 'Aster Fab One',         'operational');

INSERT INTO machines (machine_id, plant_id, name, type, status) VALUES
  (2101, 1, 'Blast Furnace A',  'furnace',   'running'),
  (2102, 1, 'Blast Furnace B',  'furnace',   'idle'),
  (2103, 1, 'Rolling Mill 1',   'mill',      'running'),
  -- THE PATIENT: main-screw bearing is dying. Everything blocked traces here.
  (2104, 1, 'Extruder Line 2',  'extruder',  'fault'),
  (2105, 1, 'CNC Cell 5',       'cnc',       'running'),
  (2106, 1, 'Conveyor North',   'conveyor',  'running'),
  (2107, 1, 'Quench Bath',      'treatment', 'running'),
  (2201, 2, 'Litho Stepper 1',  'stepper',   'running'),
  (2202, 2, 'Bond Line 1',      'bonder',    'running');

INSERT INTO work_orders (wo_id, plant_id, machine_id, product, qty, status, due_date) VALUES
  (8001, 1, 2103, 'Rail section 40m',  120, 'completed',   '2189-06-02'),
  (8002, 1, 2104, 'Conduit housing',   500, 'blocked',     '2189-06-05'),  -- overdue
  (8003, 1, 2104, 'Coolant manifold',  350, 'blocked',     '2189-06-08'),  -- overdue
  (8004, 1, 2105, 'Turbine bracket',    80, 'in_progress', '2189-06-14'),
  (8005, 1, 2101, 'Ingot batch 7',      60, 'in_progress', '2189-06-12'),
  (8006, 1, 2104, 'Hab strut kit',    1200, 'created',     '2189-06-20'),  -- queued behind the fault
  (8007, 1, 2103, 'Rail section 40m',  120, 'released',    '2189-06-18'),
  (8008, 2, 2201, 'Sensor die lot',   5000, 'in_progress', '2189-06-15'),
  (8009, 2, 2202, 'MCU bond lot',     3000, 'completed',   '2189-06-03'),
  (8010, 1, 2107, 'Quench batch 12',   200, 'completed',   '2189-06-06');

-- Historian samples. 2104's bearing_temp climbs across 24h while its
-- vibration_rms sits at ~10x the healthy machines. The furnace's 1462 C
-- core_temp is NORMAL — filter by metric.
INSERT INTO sensor_readings (reading_id, machine_id, ts, metric, value, unit) VALUES
  -- Extruder Line 2 — the failure signature
  (6001, 2104, '2189-06-09 06:00:00', 'bearing_temp',    78.2,  'C'),
  (6002, 2104, '2189-06-09 12:00:00', 'bearing_temp',    96.4,  'C'),
  (6003, 2104, '2189-06-09 18:00:00', 'bearing_temp',   121.7,  'C'),
  (6004, 2104, '2189-06-10 06:00:00', 'bearing_temp',   143.5,  'C'),
  (6005, 2104, '2189-06-10 06:00:00', 'vibration_rms',   19.3,  'mm/s'),
  (6006, 2104, '2189-06-10 06:00:00', 'barrel_pressure', 31.2,  'MPa'),
  -- healthy neighbours for contrast
  (6007, 2103, '2189-06-10 06:00:00', 'bearing_temp',    58.1,  'C'),
  (6008, 2103, '2189-06-10 06:00:00', 'vibration_rms',    2.1,  'mm/s'),
  (6009, 2105, '2189-06-10 06:00:00', 'bearing_temp',    61.4,  'C'),
  (6010, 2105, '2189-06-10 06:00:00', 'vibration_rms',    1.8,  'mm/s'),
  (6011, 2106, '2189-06-10 06:00:00', 'bearing_temp',    49.7,  'C'),
  (6012, 2106, '2189-06-10 06:00:00', 'vibration_rms',    2.6,  'mm/s'),
  -- the red herring: hot because it is a FURNACE, and perfectly fine
  (6013, 2101, '2189-06-10 06:00:00', 'core_temp',     1462.0,  'C'),
  (6014, 2101, '2189-06-10 06:00:00', 'o2_level',         3.1,  'pct'),
  (6015, 2107, '2189-06-10 06:00:00', 'bath_temp',       41.5,  'C'),
  (6016, 2201, '2189-06-10 06:00:00', 'stage_temp',      22.0,  'C'),
  (6017, 2201, '2189-06-10 06:00:00', 'throughput',     118.0,  'wafers/h'),
  (6018, 2202, '2189-06-10 06:00:00', 'bond_force',      49.8,  'N');

-- PM notifications. The paper trail of neglect on 2104.
INSERT INTO maintenance_log (log_id, machine_id, ts, event, severity) VALUES
  (7001, 2104, '2189-03-20 09:15:00', 'Scheduled bearing replacement deferred - parts unavailable',        'warning'),
  (7002, 2104, '2189-05-18 14:02:00', 'Vibration trend exceeds ISO 10816 zone C',                          'warning'),
  (7003, 2104, '2189-06-06 07:40:00', 'Auto-lubrication cycle skipped - pump fault',                       'critical'),
  (7004, 2104, '2189-06-10 06:05:00', 'Main screw bearing temperature alarm - manual stop required',       'critical'),
  (7005, 2101, '2189-06-01 10:00:00', 'Refractory inspection passed',                                      'info'),
  (7006, 2105, '2189-06-03 13:30:00', 'Tool changer calibrated',                                           'info'),
  (7007, 2106, '2189-05-29 08:20:00', 'Belt tension adjusted',                                             'info'),
  (7008, 2103, '2189-06-05 11:45:00', 'Roll gap recalibrated',                                             'info');

CREATE INDEX idx_sensor_machine ON sensor_readings(machine_id);
CREATE INDEX idx_wo_machine     ON work_orders(machine_id);
CREATE INDEX idx_maint_machine  ON maintenance_log(machine_id);
