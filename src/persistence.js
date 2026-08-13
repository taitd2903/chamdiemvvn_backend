import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

let pool = null;
let enabled = false;
let saveTimer = null;
let saving = false;
let dirtyAfterSave = false;

function cloneForStorage(state) {
  return JSON.parse(JSON.stringify(state));
}

function applyLoadedState(target, loaded) {
  const safe = loaded && typeof loaded === 'object' ? loaded : {};
  target.settings = safe.settings && typeof safe.settings === 'object' ? { ...target.settings, ...safe.settings } : target.settings;
  target.areas = Array.isArray(safe.areas) ? safe.areas.map((area) => {
    if (area?.type !== 'fighting' || Number(area.judgeCount) !== 4) return area;
    const judgeSlots = { ...(area.judgeSlots || {}) };
    delete judgeSlots[4];
    return { ...area, judgeCount: 3, judgeSlots };
  }) : target.areas;
  target.contents = Array.isArray(safe.contents) ? safe.contents : target.contents;
  target.athletes = Array.isArray(safe.athletes) ? safe.athletes : target.athletes;
  target.registrations = Array.isArray(safe.registrations) ? safe.registrations : target.registrations;
  target.formEntries = Array.isArray(safe.formEntries) ? safe.formEntries : target.formEntries;
  target.fightMatches = Array.isArray(safe.fightMatches) ? safe.fightMatches : target.fightMatches;
}

async function runSqlFileIfExists(connection, filePath) {
  try {
    const sql = await fs.readFile(filePath, 'utf8');
    if (sql.trim()) await connection.query(sql);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export function isPersistenceEnabled() {
  return enabled;
}

export async function initPersistence(state) {
  const mode = process.env.DB_MODE || (process.env.DB_HOST ? 'mysql' : 'memory');
  if (mode !== 'mysql') {
    console.log('Persistence: memory mode. Set DB_MODE=mysql to use MySQL.');
    return;
  }

  const useSsl = ['true', 'required', '1', 'yes'].includes(String(process.env.DB_SSL || '').toLowerCase());
  const config = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'vovinam_realtime',
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    multipleStatements: true,
    charset: 'utf8mb4',
    ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {})
  };

  pool = mysql.createPool(config);

  const connection = await pool.getConnection();
  try {
    await connection.query('SELECT 1');
    const schemaPath = path.resolve(process.cwd(), 'db/schema.sql');
    await runSqlFileIfExists(connection, schemaPath);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS app_state (
        id VARCHAR(64) PRIMARY KEY,
        data JSON NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const [rows] = await connection.query('SELECT data FROM app_state WHERE id = ?', ['main']);
    if (rows.length > 0) {
      const loaded = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
      applyLoadedState(state, loaded);
      console.log('Persistence: loaded state from MySQL.');
    } else {
      await saveStateNow(state);
      console.log('Persistence: seeded initial state into MySQL.');
    }
    enabled = true;
  } finally {
    connection.release();
  }
}

export async function saveStateNow(state) {
  if (!pool) return;
  const payload = JSON.stringify(cloneForStorage(state));
  await pool.query(
    `INSERT INTO app_state (id, data)
     VALUES (?, CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE data = VALUES(data)`,
    ['main', payload]
  );
}

export function schedulePersistState(state, delayMs = 250) {
  if (!enabled || !pool) return;

  if (saving) {
    dirtyAfterSave = true;
    return;
  }

  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    saving = true;
    try {
      await saveStateNow(state);
    } catch (error) {
      console.error('Persistence save failed:', error.message);
    } finally {
      saving = false;
      if (dirtyAfterSave) {
        dirtyAfterSave = false;
        schedulePersistState(state, delayMs);
      }
    }
  }, delayMs);
}

export async function closePersistence() {
  if (saveTimer) clearTimeout(saveTimer);
  if (pool) await pool.end();
}
