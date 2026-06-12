-- ============================================================================
-- ASTER HR  ·  Aster Dynamics — Human Capital Management core
-- ----------------------------------------------------------------------------
-- Real-world analog: Workday / SAP SuccessFactors HCM. This is the canonical
-- "system of record" for people: org structure (departments -> positions),
-- the employee master, position/role history (effective-dated, like Workday
-- "business processes"), and a payroll period ledger. Column names mirror what
-- you'd actually grep in an enterprise HRIS, so the SQL here transfers to a real
-- HCM job: cost_center, position level bands, manager_id self-reference,
-- effective_date history rows, gross/net payroll.
--
-- STORY (diegetic dev note):
--   employee_id 1989 is MARA — the player's sister. Her row is real and fully
--   wired (manager, position, job_history, payroll). THE KERNEL targets exactly
--   this row across HR + identity. The mission will DELETE it (and the player
--   restores it). See the v_kernel_targets view + the "KERNEL TARGET" comments
--   below — they mark every dependent row that must vanish/return with her.
-- ============================================================================

-- FK relationships are declared for documentation/joins but NOT enforced
-- (PRAGMA foreign_keys stays off): the erasure beat deletes the employees row
-- and leaves job_history/payroll orphans behind — the evidence of the wipe.
PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------------------
-- Org structure
-- ---------------------------------------------------------------------------
CREATE TABLE departments (
  dept_id      INTEGER PRIMARY KEY,
  name         TEXT    NOT NULL,
  cost_center  TEXT    NOT NULL    -- finance roll-up code, e.g. CC-ENG-001
);

CREATE TABLE positions (
  position_id  INTEGER PRIMARY KEY,
  title        TEXT    NOT NULL,
  dept_id      INTEGER NOT NULL REFERENCES departments(dept_id),
  level        INTEGER NOT NULL    -- career band 1..7 (IC1 .. exec)
);

-- ---------------------------------------------------------------------------
-- Employee master
--   manager_id is a self-reference (the reporting chain).
--   national_id_hash stands in for a salted PII token — you never store the
--   raw national id in an HRIS; you store a one-way hash. (Diegetic + realistic.)
-- ---------------------------------------------------------------------------
CREATE TABLE employees (
  employee_id      INTEGER PRIMARY KEY,
  first_name       TEXT    NOT NULL,
  last_name        TEXT    NOT NULL,
  email            TEXT    NOT NULL UNIQUE,
  position_id      INTEGER REFERENCES positions(position_id),
  dept_id          INTEGER REFERENCES departments(dept_id),
  manager_id       INTEGER REFERENCES employees(employee_id),
  hire_date        TEXT    NOT NULL,             -- ISO date
  status           TEXT    NOT NULL DEFAULT 'active', -- active|terminated|leave
  national_id_hash TEXT
);

-- Effective-dated position/status history (Workday-style change log).
CREATE TABLE job_history (
  history_id     INTEGER PRIMARY KEY,
  employee_id    INTEGER NOT NULL REFERENCES employees(employee_id),
  position_id    INTEGER REFERENCES positions(position_id),
  dept_id        INTEGER REFERENCES departments(dept_id),
  event_type     TEXT    NOT NULL,   -- hire|promotion|transfer|leave|return
  effective_date TEXT    NOT NULL
);

-- Payroll period ledger (one row per employee per pay period).
CREATE TABLE payroll (
  payroll_id   INTEGER PRIMARY KEY,
  employee_id  INTEGER NOT NULL REFERENCES employees(employee_id),
  period       TEXT    NOT NULL,     -- YYYY-MM
  gross        REAL    NOT NULL,
  net          REAL    NOT NULL,
  currency     TEXT    NOT NULL DEFAULT 'NEC'  -- New Eurodollar Credits
);

-- ===========================================================================
-- SEED DATA  (deterministic)
-- ===========================================================================

-- Departments -----------------------------------------------------------------
INSERT INTO departments (dept_id, name, cost_center) VALUES
  (10, 'Executive',           'CC-EXE-001'),
  (20, 'Engineering',         'CC-ENG-001'),
  (30, 'Grid Operations',     'CC-OPS-014'),
  (40, 'Security',            'CC-SEC-007'),
  (50, 'Human Resources',     'CC-HRX-002'),
  (60, 'Finance',             'CC-FIN-003'),
  (70, 'Research',            'CC-RND-021');

-- Positions -------------------------------------------------------------------
INSERT INTO positions (position_id, title, dept_id, level) VALUES
  (100, 'Chief Executive',         10, 7),
  (101, 'VP Engineering',          20, 6),
  (102, 'Staff Engineer',          20, 5),
  (103, 'Senior Engineer',         20, 4),
  (104, 'Engineer',                20, 3),
  (105, 'Junior Engineer',         20, 2),
  (110, 'Grid Operations Lead',    30, 5),
  (111, 'Grid Operator',           30, 3),
  (112, 'Grid Operator',           30, 3),
  (120, 'Security Director',       40, 6),
  (121, 'Security Analyst',        40, 3),
  (130, 'HR Director',             50, 5),
  (131, 'HR Generalist',           50, 3),
  (140, 'Controller',              60, 5),
  (141, 'Payroll Specialist',      60, 3),
  (150, 'Principal Researcher',    70, 6),
  (151, 'Research Scientist',      70, 4);

-- Employees -------------------------------------------------------------------
-- manager_id chains: 1001 (CEO) at top. Mara = 1989.
INSERT INTO employees
  (employee_id, first_name, last_name, email, position_id, dept_id, manager_id, hire_date, status, national_id_hash) VALUES
  (1001, 'Iola',     'Vance',     'iola.vance@asterdyn.grid',     100, 10, NULL, '2171-02-11', 'active',     'a91f00de'),
  (1002, 'Desmond',  'Aoki',      'desmond.aoki@asterdyn.grid',   101, 20, 1001, '2174-06-30', 'active',     '4c7b21aa'),
  (1003, 'Priya',    'Sundaram',  'priya.sundaram@asterdyn.grid', 102, 20, 1002, '2176-09-12', 'active',     'd3f9c180'),
  (1004, 'Bjorn',    'Halloran',  'bjorn.halloran@asterdyn.grid', 103, 20, 1003, '2179-01-22', 'active',     '7e0a4411'),
  (1005, 'Nuru',     'Okafor',    'nuru.okafor@asterdyn.grid',    103, 20, 1003, '2179-03-05', 'active',     'bb19d702'),
  (1006, 'Teodora',  'Marchetti', 'teodora.marchetti@asterdyn.grid',104,20, 1004, '2181-07-19', 'active',    '5510fa8c'),
  (1007, 'Kwame',    'Adeyemi',   'kwame.adeyemi@asterdyn.grid',  104, 20, 1004, '2181-08-02', 'active',     '9a02bb31'),
  (1008, 'Lena',     'Castellano','lena.castellano@asterdyn.grid',105, 20, 1005, '2184-04-14', 'active',     '0fc7e620'),
  (1009, 'Yusuf',    'Demir',     'yusuf.demir@asterdyn.grid',    105, 20, 1005, '2184-11-30', 'active',     '2dd84190'),
  (1010, 'Ravi',     'Anand',     'ravi.anand@asterdyn.grid',     110, 30, 1001, '2173-05-08', 'active',     'cc41f0a7'),
  (1011, 'Soraya',   'Idris',     'soraya.idris@asterdyn.grid',   111, 30, 1010, '2178-02-17', 'active',     'e8810b34'),
  (1012, 'Marcus',   'Tan',       'marcus.tan@asterdyn.grid',     112, 30, 1010, '2180-10-26', 'active',     '13ac99fe'),
  (1013, 'Galina',   'Petrova',   'galina.petrova@asterdyn.grid', 120, 40, 1001, '2172-12-03', 'active',     '77be20cd'),
  (1014, 'Aaron',    'Sloane',    'aaron.sloane@asterdyn.grid',   121, 40, 1013, '2182-06-21', 'active',     'aa55de01'),
  (1015, 'Fenwick',  'Cole',      'fenwick.cole@asterdyn.grid',   121, 40, 1013, '2183-09-09', 'active',     'd09f1b6e'),
  (1016, 'Naomi',    'Bright',    'naomi.bright@asterdyn.grid',   130, 50, 1001, '2175-03-15', 'active',     '6b2c70aa'),
  (1017, 'Inez',     'Fonseca',   'inez.fonseca@asterdyn.grid',   131, 50, 1016, '2185-01-29', 'active',     '4f9930ee'),
  (1018, 'Walter',   'Kade',      'walter.kade@asterdyn.grid',    140, 60, 1001, '2174-08-08', 'active',     'c1b840a3'),
  (1019, 'Mireille', 'Dubois',    'mireille.dubois@asterdyn.grid',141, 60, 1018, '2186-05-04', 'active',     '8810ffac'),
  (1020, 'Hassan',   'El-Amin',   'hassan.elamin@asterdyn.grid',  150, 70, 1001, '2173-10-19', 'active',     '90ab12cd'),
  (1021, 'Selene',   'Voss',      'selene.voss@asterdyn.grid',    151, 70, 1020, '2181-02-28', 'active',     'fa01d7b9'),
  (1022, 'Dmitri',   'Volkov',    'dmitri.volkov@asterdyn.grid',  151, 70, 1020, '2183-11-11', 'active',     '2b66ce40'),
  (1023, 'Esme',     'Lindqvist', 'esme.lindqvist@asterdyn.grid', 104, 20, 1004, '2185-07-07', 'active',     '0e7799ba'),
  (1024, 'Tobias',   'Renner',    'tobias.renner@asterdyn.grid',  131, 50, 1016, '2186-09-23', 'leave',      '551f0a2d'),

  -- ===================== KERNEL TARGET: MARA (the sister) =====================
  -- A real, fully-wired employee. Engineer in Grid Operations, reports to Ravi.
  -- This is the row reality is being rewritten to forget. The mission deletes &
  -- restores it. Memorable id 1989. Her dependents (job_history, payroll, and the
  -- grid_rbac identity row) are the rest of the erasure footprint.
  (1989, 'Mara',     'Okonkwo',   'mara.okonkwo@asterdyn.grid',   111, 30, 1010, '2185-04-02', 'active',     'm4r4ec0d');
  -- ===========================================================================

-- Job history (effective-dated) ----------------------------------------------
INSERT INTO job_history (history_id, employee_id, position_id, dept_id, event_type, effective_date) VALUES
  (5001, 1002, 104, 20, 'hire',      '2174-06-30'),
  (5002, 1002, 103, 20, 'promotion', '2177-01-01'),
  (5003, 1002, 102, 20, 'promotion', '2179-07-01'),
  (5004, 1002, 101, 20, 'promotion', '2182-01-01'),
  (5005, 1003, 104, 20, 'hire',      '2176-09-12'),
  (5006, 1003, 102, 20, 'promotion', '2180-01-01'),
  (5007, 1010, 111, 30, 'hire',      '2173-05-08'),
  (5008, 1010, 110, 30, 'promotion', '2177-04-01'),
  (5009, 1011, 111, 30, 'hire',      '2178-02-17'),
  (5010, 1016, 131, 50, 'hire',      '2175-03-15'),
  (5011, 1016, 130, 50, 'promotion', '2179-06-01'),
  (5012, 1024, 131, 50, 'hire',      '2186-09-23'),
  (5013, 1024, 131, 50, 'leave',     '2189-05-30'),
  -- KERNEL TARGET: Mara's history. Hired into Grid Ops, promoted within band.
  (5014, 1989, 112, 30, 'hire',      '2185-04-02'),
  (5015, 1989, 111, 30, 'transfer',  '2187-09-15');

-- Payroll ledger (recent periods) --------------------------------------------
INSERT INTO payroll (payroll_id, employee_id, period, gross, net, currency) VALUES
  (9001, 1002, '2189-04', 22400.00, 15120.00, 'NEC'),
  (9002, 1002, '2189-05', 22400.00, 15120.00, 'NEC'),
  (9003, 1003, '2189-04', 18900.00, 12880.00, 'NEC'),
  (9004, 1003, '2189-05', 18900.00, 12880.00, 'NEC'),
  (9005, 1010, '2189-04', 16700.00, 11540.00, 'NEC'),
  (9006, 1010, '2189-05', 16700.00, 11540.00, 'NEC'),
  (9007, 1011, '2189-04',  9800.00,  7210.00, 'NEC'),
  (9008, 1011, '2189-05',  9800.00,  7210.00, 'NEC'),
  (9009, 1016, '2189-04', 15200.00, 10640.00, 'NEC'),
  (9010, 1016, '2189-05', 15200.00, 10640.00, 'NEC'),
  (9011, 1020, '2189-04', 19500.00, 13260.00, 'NEC'),
  (9012, 1020, '2189-05', 19500.00, 13260.00, 'NEC'),
  -- KERNEL TARGET: Mara's pay stubs. Two real periods, then the gap begins.
  (9013, 1989, '2189-04',  9600.00,  7080.00, 'NEC'),
  (9014, 1989, '2189-05',  9600.00,  7080.00, 'NEC');

-- ---------------------------------------------------------------------------
-- Companion view: the erasure manifest.
--   `SELECT * FROM v_kernel_targets;` shows every HR row pinned to Mara — the
--   footprint The Kernel must wipe to make her never have existed. The player
--   uses this to confirm restoration is complete.
-- ---------------------------------------------------------------------------
CREATE VIEW v_kernel_targets AS
  SELECT 'employees'   AS source_table, e.employee_id AS ref_id,
         e.first_name || ' ' || e.last_name AS detail
    FROM employees e WHERE e.employee_id = 1989
  UNION ALL
  SELECT 'job_history', jh.history_id, jh.event_type || ' @ ' || jh.effective_date
    FROM job_history jh WHERE jh.employee_id = 1989
  UNION ALL
  SELECT 'payroll', p.payroll_id, p.period || ' net ' || CAST(p.net AS TEXT)
    FROM payroll p WHERE p.employee_id = 1989;
