import 'dotenv/config';
import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';

if (process.env.RESET_DATABASE !== 'YES') throw new Error('Set RESET_DATABASE=YES to confirm a destructive reset');

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: ['true', 'required', '1', 'yes'].includes(String(process.env.DB_SSL || '').toLowerCase()) ? { rejectUnauthorized: false } : undefined,
  multipleStatements: true,
  charset: 'utf8mb4'
});

try {
  const [tables] = await connection.query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`, [process.env.DB_NAME]);
  await connection.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const { TABLE_NAME } of tables) await connection.query(`DROP TABLE IF EXISTS \`${String(TABLE_NAME).replaceAll('`', '``')}\``);
  await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  await connection.query(await fs.readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  await connection.query(await fs.readFile(new URL('../db/migrations/20260813_production_sync.sql', import.meta.url), 'utf8'));
  await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id VARCHAR(255) PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await connection.query(`INSERT IGNORE INTO schema_migrations (id) VALUES ('20260813_production_sync')`);
  const [created] = await connection.query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`, [process.env.DB_NAME]);
  const [[userRole]] = await connection.query(`SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`, [process.env.DB_NAME]);
  const [[fightStatus]] = await connection.query(`SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'fight_matches' AND COLUMN_NAME = 'status'`, [process.env.DB_NAME]);
  const [[stateCount]] = await connection.query(`SELECT COUNT(*) AS count FROM app_state`);
  console.log(`Database reset complete. Created ${created.length} tables.`);
  console.log(created.map((row) => row.TABLE_NAME).join(', '));
  console.log(`User roles: ${userRole.COLUMN_TYPE}`);
  console.log(`Fight statuses: ${fightStatus.COLUMN_TYPE}`);
  console.log(`Initial app_state rows: ${stateCount.count}`);
} finally {
  await connection.end();
}
