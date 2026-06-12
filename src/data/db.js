// ============================================================================
// NETRUNNER · src/data/db.js — sql.js wrapper for the corp databases.
//
// Each corp runs a real-shaped enterprise stack (see schemas/*.sql). This
// module boots sql.js (wasm served from /sql-wasm.wasm in public/), seeds one
// in-memory SQLite database per corp, and exposes a guarded query() used by
// the `sql` command in the terminal (sim-shell.js).
//
//   initSql()        → memoized sql.js module
//   openDB(corpId)   → memoized seeded Database ('aster_hr'|'grid_rbac'|'forge_erp')
//   query(db, sql)   → {columns, rows} | {error}  (writes allowed, structure guarded)
// ============================================================================

import initSqlJs from 'sql.js';

// Vite ?raw imports: the DDL+seed text is bundled as plain strings.
import asterHrSql from './schemas/aster_hr.sql?raw';
import gridRbacSql from './schemas/grid_rbac.sql?raw';
import forgeErpSql from './schemas/forge_erp.sql?raw';

const SCHEMAS = {
  aster_hr: asterHrSql,
  grid_rbac: gridRbacSql,
  forge_erp: forgeErpSql,
};

// --------------------------------------------------------------- initSql ---
let _sqlPromise = null;

/** Load the sql.js wasm module once; every later call returns the same promise. */
export async function initSql() {
  if (!_sqlPromise) {
    _sqlPromise = initSqlJs({ locateFile: () => '/sql-wasm.wasm' });
  }
  return _sqlPromise;
}

// ---------------------------------------------------------------- openDB ---
const _dbPromises = new Map();

/**
 * Open (or return the already-open) database for a corp.
 * @param {'aster_hr'|'grid_rbac'|'forge_erp'} corpId
 * @returns {Promise<import('sql.js').Database>}
 */
export async function openDB(corpId) {
  if (_dbPromises.has(corpId)) return _dbPromises.get(corpId);

  const ddl = SCHEMAS[corpId];
  if (!ddl) {
    throw new Error(
      `unknown corp database "${corpId}" (known hosts: ${Object.keys(SCHEMAS).join(', ')})`
    );
  }

  const promise = (async () => {
    const SQL = await initSql();
    const db = new SQL.Database();
    db.exec(ddl);
    return db;
  })();

  // Memoize the promise (not the db) so concurrent opens share one boot;
  // drop it on failure so a transient wasm hiccup is retryable.
  _dbPromises.set(corpId, promise);
  try {
    return await promise;
  } catch (err) {
    _dbPromises.delete(corpId);
    throw err;
  }
}

// ----------------------------------------------------------------- query ---
const MAX_ROWS = 500;

// Players may read AND write rows (missions hinge on UPDATE/DELETE/INSERT —
// restoring Mara's record is literally the plot). What they may NOT do is
// tear down or rewire the schema itself, attach other files, or vacuum the
// store out from under a running mission.
const STRUCTURAL_GUARD =
  /\b(?:attach|detach|vacuum|reindex)\b|\bdrop\s+(?:table|view|index|trigger)\b|\balter\s+table\b/i;

/**
 * Run SQL against an open corp database.
 * @param {import('sql.js').Database} db  database from openDB()
 * @param {string} sql                    one or more statements
 * @returns {{columns:string[],rows:any[][],changes?:number,truncated?:boolean}|{error:string}}
 */
export function query(db, sql) {
  if (!db || typeof db.exec !== 'function') {
    return { error: 'no database attached - jack into a corp host first' };
  }
  if (typeof sql !== 'string' || !sql.trim()) {
    return { error: 'empty statement' };
  }
  if (STRUCTURAL_GUARD.test(sql)) {
    return {
      error:
        'GRIDSEC ICE: structural change rejected (DROP/ALTER/ATTACH/VACUUM are firewalled on this host)',
    };
  }

  try {
    const results = db.exec(sql);

    if (!results.length) {
      // No result set: INSERT/UPDATE/DELETE (or a SELECT matching nothing).
      return { columns: [], rows: [], changes: db.getRowsModified() };
    }

    // Multiple statements → report the last result set (matches sqlite3 CLI feel).
    const last = results[results.length - 1];
    const out = { columns: last.columns, rows: last.values };
    if (out.rows.length > MAX_ROWS) {
      out.rows = out.rows.slice(0, MAX_ROWS);
      out.truncated = true;
    }
    return out;
  } catch (err) {
    // sql.js throws plain Errors with sqlite's message text — surface it
    // verbatim; real error messages are part of learning real SQL.
    return { error: String((err && err.message) || err) };
  }
}
