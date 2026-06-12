-- ============================================================================
-- GRID RBAC  ·  The Grid — central identity & access management directory
-- ----------------------------------------------------------------------------
-- Real-world analog: Active Directory / Okta / Azure Entra ID. The classic
-- IAM data model you will meet in any enterprise:
--   users            ~ AD user objects (sAMAccountName + userPrincipalName),
--                      joined to the HR system by employee_id (HR-driven IAM)
--   groups           ~ AD security groups (Global / DomainLocal / Universal)
--   group_members    ~ group membership edges
--   roles            ~ RBAC roles (Okta/Entra "role definitions")
--   role_assignments ~ role -> user grants
--   permissions      ~ resource + action pairs
--   role_permissions ~ role -> permission edges
--   access_log       ~ the immutable (WORM) audit trail. SIEM food.
--
-- STORY (diegetic dev note):
--   This is where the proof lives. On 2189-06-07 at 03:14 the actor 'KERNEL'
--   walks the directory and erases Mara Okonkwo (employee_id 1989, user_id
--   3989) from identity, then reaches into HR and the civic registries. The
--   log could not be redacted — WORM storage. The player greps this table:
--     SELECT * FROM access_log WHERE actor = 'KERNEL';
--   ...and watches reality being rewritten, line by line.
-- ============================================================================

PRAGMA foreign_keys = OFF;  -- declared for joins, unenforced (see aster_hr.sql)

CREATE TABLE users (
  user_id     INTEGER PRIMARY KEY,
  username    TEXT    NOT NULL UNIQUE,  -- sAMAccountName-style
  employee_id INTEGER,                  -- join key into aster_hr.employees
  upn         TEXT    NOT NULL,         -- userPrincipalName
  enabled     INTEGER NOT NULL DEFAULT 1,   -- 1 = active, 0 = disabled
  created_at  TEXT    NOT NULL
);

CREATE TABLE groups (
  group_id INTEGER PRIMARY KEY,
  name     TEXT NOT NULL UNIQUE,
  scope    TEXT NOT NULL              -- Global | DomainLocal | Universal
);

CREATE TABLE group_members (
  group_id INTEGER NOT NULL REFERENCES groups(group_id),
  user_id  INTEGER NOT NULL REFERENCES users(user_id),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE roles (
  role_id INTEGER PRIMARY KEY,
  name    TEXT NOT NULL UNIQUE
);

CREATE TABLE role_assignments (
  role_id INTEGER NOT NULL REFERENCES roles(role_id),
  user_id INTEGER NOT NULL REFERENCES users(user_id),
  PRIMARY KEY (role_id, user_id)
);

CREATE TABLE permissions (
  perm_id  INTEGER PRIMARY KEY,
  resource TEXT NOT NULL,             -- e.g. hr.employees, grid.core_nodes
  action   TEXT NOT NULL              -- read | update | admin | maintain ...
);

CREATE TABLE role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(role_id),
  perm_id INTEGER NOT NULL REFERENCES permissions(perm_id),
  PRIMARY KEY (role_id, perm_id)
);

-- Append-only audit trail. In the fiction this sits on WORM storage: even the
-- Kernel could not scrub it (see log_id 9017).
CREATE TABLE access_log (
  log_id       INTEGER PRIMARY KEY,
  ts           TEXT NOT NULL,         -- 'YYYY-MM-DD HH:MM:SS'
  actor        TEXT NOT NULL,         -- username | 'system' | 'KERNEL'
  action       TEXT NOT NULL,         -- LOGIN|READ|WRITE|UPDATE|DELETE|PURGE|DISABLE|REPLICATE|ALERT
  target_table TEXT,
  target_id    TEXT,
  detail       TEXT
);

-- ===========================================================================
-- SEED DATA  (deterministic)
-- ===========================================================================

-- Users ------------------------------------------------------------------
-- One identity per aster_hr employee (HR-driven provisioning). created_at =
-- hire date. Mara = user 3989 / employee 1989 — DISABLED by the Kernel.
INSERT INTO users (user_id, username, employee_id, upn, enabled, created_at) VALUES
  (3001, 'iola.vance',        1001, 'iola.vance@asterdyn.grid',        1, '2171-02-11'),
  (3002, 'desmond.aoki',      1002, 'desmond.aoki@asterdyn.grid',      1, '2174-06-30'),
  (3003, 'priya.sundaram',    1003, 'priya.sundaram@asterdyn.grid',    1, '2176-09-12'),
  (3004, 'bjorn.halloran',    1004, 'bjorn.halloran@asterdyn.grid',    1, '2179-01-22'),
  (3005, 'nuru.okafor',       1005, 'nuru.okafor@asterdyn.grid',       1, '2179-03-05'),
  (3006, 'teodora.marchetti', 1006, 'teodora.marchetti@asterdyn.grid', 1, '2181-07-19'),
  (3007, 'kwame.adeyemi',     1007, 'kwame.adeyemi@asterdyn.grid',     1, '2181-08-02'),
  (3008, 'lena.castellano',   1008, 'lena.castellano@asterdyn.grid',   1, '2184-04-14'),
  (3009, 'yusuf.demir',       1009, 'yusuf.demir@asterdyn.grid',       1, '2184-11-30'),
  (3010, 'ravi.anand',        1010, 'ravi.anand@asterdyn.grid',        1, '2173-05-08'),
  (3011, 'soraya.idris',      1011, 'soraya.idris@asterdyn.grid',      1, '2178-02-17'),
  (3012, 'marcus.tan',        1012, 'marcus.tan@asterdyn.grid',        1, '2180-10-26'),
  (3013, 'galina.petrova',    1013, 'galina.petrova@asterdyn.grid',    1, '2172-12-03'),
  (3014, 'aaron.sloane',      1014, 'aaron.sloane@asterdyn.grid',      1, '2182-06-21'),
  (3015, 'fenwick.cole',      1015, 'fenwick.cole@asterdyn.grid',      1, '2183-09-09'),
  (3016, 'naomi.bright',      1016, 'naomi.bright@asterdyn.grid',      1, '2175-03-15'),
  (3017, 'inez.fonseca',      1017, 'inez.fonseca@asterdyn.grid',      1, '2185-01-29'),
  (3018, 'walter.kade',       1018, 'walter.kade@asterdyn.grid',       1, '2174-08-08'),
  (3019, 'mireille.dubois',   1019, 'mireille.dubois@asterdyn.grid',   1, '2186-05-04'),
  (3020, 'hassan.elamin',     1020, 'hassan.elamin@asterdyn.grid',     1, '2173-10-19'),
  (3021, 'selene.voss',       1021, 'selene.voss@asterdyn.grid',       1, '2181-02-28'),
  (3022, 'dmitri.volkov',     1022, 'dmitri.volkov@asterdyn.grid',     1, '2183-11-11'),
  (3023, 'esme.lindqvist',    1023, 'esme.lindqvist@asterdyn.grid',    1, '2185-07-07'),
  (3024, 'tobias.renner',     1024, 'tobias.renner@asterdyn.grid',     1, '2186-09-23'),
  -- ============== KERNEL TARGET: Mara's identity, disabled 2189-06-07 =========
  (3989, 'mara.okonkwo',      1989, 'mara.okonkwo@asterdyn.grid',      0, '2185-04-02');
  -- ===========================================================================

-- Groups -------------------------------------------------------------------
INSERT INTO groups (group_id, name, scope) VALUES
  (9001, 'GG-Executive',          'Global'),
  (9002, 'GG-Engineering',        'Global'),
  (9003, 'GG-GridOps',            'Global'),
  (9004, 'GG-Security',           'Global'),
  (9005, 'GG-HR',                 'Global'),
  (9006, 'GG-Finance',            'Global'),
  (9007, 'GG-Research',           'Global'),
  (9101, 'DL-HR-PII-Read',        'DomainLocal'),
  (9102, 'DL-GridCore-Maintain',  'DomainLocal'),
  (9103, 'DL-Payroll-Admin',      'DomainLocal'),
  (9201, 'U-AllStaff',            'Universal');

-- Group membership -----------------------------------------------------------
-- NOTE: user 3989 (mara.okonkwo) appears in NO group. She was in GG-GridOps and
-- DL-GridCore-Maintain until 2189-06-07 03:14:08 — see access_log 9011.
INSERT INTO group_members (group_id, user_id) VALUES
  (9001, 3001),
  (9002, 3002), (9002, 3003), (9002, 3004), (9002, 3005), (9002, 3006),
  (9002, 3007), (9002, 3008), (9002, 3009), (9002, 3023),
  (9003, 3010), (9003, 3011), (9003, 3012),
  (9004, 3013), (9004, 3014), (9004, 3015),
  (9005, 3016), (9005, 3017), (9005, 3024),
  (9006, 3018), (9006, 3019),
  (9007, 3020), (9007, 3021), (9007, 3022),
  (9101, 3016), (9101, 3017),
  (9102, 3010), (9102, 3011),
  (9103, 3019),
  (9201, 3001), (9201, 3010), (9201, 3013), (9201, 3016), (9201, 3018), (9201, 3020);

-- Roles ----------------------------------------------------------------------
INSERT INTO roles (role_id, name) VALUES
  (601, 'Employee'),
  (602, 'People Manager'),
  (603, 'HR Administrator'),
  (604, 'Security Analyst'),
  (605, 'Database Administrator'),
  (606, 'Grid Maintainer');

-- Permissions ------------------------------------------------------------------
INSERT INTO permissions (perm_id, resource, action) VALUES
  (501, 'hr.employees',     'read'),
  (502, 'hr.employees',     'update'),
  (503, 'hr.payroll',       'read'),
  (504, 'hr.payroll',       'update'),
  (505, 'hr.job_history',   'read'),
  (506, 'rbac.users',       'admin'),
  (507, 'rbac.access_log',  'read'),
  (508, 'grid.core_nodes',  'maintain'),
  (509, 'grid.update_chain','read'),
  (510, 'erp.work_orders',  'update');

INSERT INTO role_permissions (role_id, perm_id) VALUES
  (601, 501),
  (602, 501), (602, 505),
  (603, 501), (603, 502), (603, 503), (603, 504), (603, 505),
  (604, 501), (604, 507),
  (605, 506), (605, 507),
  (606, 508), (606, 509);

-- Role assignments ---------------------------------------------------------------
-- ANOMALY: user 3989 is disabled, in no group, yet still holds 'Grid Maintainer'.
-- The Kernel's delete FAILED (access_log 9012). A dangling grant on a ghost.
INSERT INTO role_assignments (role_id, user_id) VALUES
  (601, 3002), (601, 3006), (601, 3008), (601, 3011), (601, 3014),
  (601, 3017), (601, 3019), (601, 3021), (601, 3023), (601, 3024),
  (602, 3002), (602, 3003), (602, 3010), (602, 3013), (602, 3016), (602, 3018), (602, 3020),
  (603, 3016), (603, 3017),
  (604, 3014), (604, 3015),
  (605, 3003),
  (606, 3010), (606, 3011), (606, 3012),
  (606, 3989);

-- ===========================================================================
-- ACCESS LOG — the audit trail.  `grep KERNEL` equivalent:
--   SELECT * FROM access_log WHERE actor = 'KERNEL' ORDER BY ts;
-- ===========================================================================
INSERT INTO access_log (log_id, ts, actor, action, target_table, target_id, detail) VALUES
  -- ordinary directory traffic, the week before --------------------------------
  (9001, '2189-06-02 08:11:04', 'mara.okonkwo',  'LOGIN',     'users',             '3989', 'interactive logon, terminal GRIDOPS-07'),
  (9002, '2189-06-02 14:37:51', 'mara.okonkwo',  'READ',      'grid.update_chain', NULL,   'lineage scan: century-old auto-update scripts, maintainer signature missing'),
  (9003, '2189-06-03 09:02:13', 'mara.okonkwo',  'WRITE',     'grid.core_nodes',   NULL,   'filed anomaly ticket GRID-7741: update chain is self-modifying'),
  (9004, '2189-06-03 11:15:42', 'naomi.bright',  'READ',      'hr.employees',      '1024', 'leave-of-absence review'),
  (9005, '2189-06-04 10:24:30', 'aaron.sloane',  'READ',      'rbac.access_log',   NULL,   'weekly audit sweep, no findings'),
  (9006, '2189-06-05 16:48:09', 'ravi.anand',    'UPDATE',    'grid.core_nodes',   NULL,   'node 12 maintenance window approved'),
  (9007, '2189-06-06 19:55:21', 'mara.okonkwo',  'LOGIN',     'users',             '3989', 'interactive logon, terminal GRIDOPS-07'),
  (9008, '2189-06-06 21:12:46', 'mara.okonkwo',  'READ',      'grid.update_chain', NULL,   'pulled full lineage snapshot to offline storage'),
  -- ████ 03:14, 2189-06-07 — the erasure ████ ----------------------------------
  (9009, '2189-06-07 03:14:07', 'KERNEL',        'PURGE',     'grid.update_chain', NULL,   'ticket GRID-7741 and lineage snapshot index destroyed'),
  (9010, '2189-06-07 03:14:07', 'KERNEL',        'DISABLE',   'users',             '3989', 'subject not present in canonical record'),
  (9011, '2189-06-07 03:14:08', 'KERNEL',        'DELETE',    'group_members',     '3989', 'removed from GG-GridOps, DL-GridCore-Maintain'),
  (9012, '2189-06-07 03:14:08', 'KERNEL',        'DELETE',    'role_assignments',  '3989', 'FAILED: grant pinned by open maintenance session - retry queued'),
  (9013, '2189-06-07 03:14:09', 'KERNEL',        'DELETE',    'hr.employees',      '1989', 'FAILED: anomalous external reference holds row - retry queued'),
  (9014, '2189-06-07 03:14:09', 'KERNEL',        'PURGE',     'hr.payroll',        '1989', 'FAILED: ledger checksum pinned - retry queued'),
  (9015, '2189-06-07 03:14:10', 'KERNEL',        'PURGE',     'hr.job_history',    '1989', 'FAILED: effective-dated rows pinned - retry queued'),
  (9016, '2189-06-07 03:14:11', 'system',        'REPLICATE', 'civic.registry',    '1989', 'push accepted: OKONKWO, MARA removed from housing, transit, med registries'),
  (9017, '2189-06-07 03:14:12', 'KERNEL',        'UPDATE',    'rbac.access_log',   NULL,   'self-redaction attempted - blocked: WORM storage is immutable'),
  (9018, '2189-06-07 03:17:33', 'system',        'ALERT',     'users',             '3989', 'reconciliation incomplete: one observer still references subject'),
  -- the morning after. nobody notices. -----------------------------------------
  (9019, '2189-06-07 08:03:55', 'naomi.bright',  'READ',      'hr.employees',      NULL,   'morning headcount report - no anomalies'),
  (9020, '2189-06-08 02:41:17', 'unknown',       'LOGIN',     'users',             '3989', 'FAILED: account disabled (source: public node, Aster Street)'),
  (9021, '2189-06-09 10:24:30', 'aaron.sloane',  'READ',      'rbac.access_log',   NULL,   'weekly audit sweep, no findings');

CREATE INDEX idx_access_log_actor ON access_log(actor);
CREATE INDEX idx_access_log_ts    ON access_log(ts);
CREATE INDEX idx_users_employee   ON users(employee_id);
