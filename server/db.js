// SQLite layer: users, passkey credentials, audit log.
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'admin.db');

let _db;
export function db() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  migrate(_db);
  return _db;
}

function migrate(d) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      display_name  TEXT,
      is_admin      INTEGER NOT NULL DEFAULT 0,
      disabled      INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS credentials (
      id            TEXT PRIMARY KEY,          -- base64url credential id
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      public_key    TEXT NOT NULL,             -- base64 SPKI
      counter       INTEGER NOT NULL,
      device_type   TEXT,
      transports    TEXT,                      -- JSON array
      nickname      TEXT,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id            INTEGER PRIMARY KEY,
      ts            TEXT NOT NULL,
      user_id       INTEGER,
      action        TEXT NOT NULL,
      detail        TEXT                       -- JSON blob
    );

    -- bootstrap_token burned flag (single row, id=1)
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

// ---- helpers ----
const now = () => new Date().toISOString();

export function audit(userId, action, detail = {}) {
  db().prepare(
    'INSERT INTO audit_log (ts, user_id, action, detail) VALUES (?, ?, ?, ?)'
  ).run(now(), userId ?? null, action, JSON.stringify(detail));
}

export function isAdminBootstrapped() {
  return db().prepare('SELECT value FROM meta WHERE key = ?').get('bootstrap_done')?.value === '1';
}

export function markBootstrapped() {
  db().prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run('bootstrap_done', '1');
}

// user CRUD
export const Users = {
  all() {
    return db().prepare('SELECT * FROM users ORDER BY created_at').all();
  },
  byId(id) {
    return db().prepare('SELECT * FROM users WHERE id = ?').get(id);
  },
  byUsername(username) {
    return db().prepare('SELECT * FROM users WHERE username = ?').get(username);
  },
  create({ username, display_name, is_admin = 0 }) {
    const info = db().prepare(
      'INSERT INTO users (username, display_name, is_admin, created_at) VALUES (?, ?, ?, ?)'
    ).run(username, display_name ?? null, is_admin ? 1 : 0, now());
    return this.byId(info.lastInsertRowid);
  },
  setAdmin(id, isAdmin) {
    db().prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, id);
  },
  setDisabled(id, disabled) {
    db().prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, id);
  },
  remove(id) {
    db().prepare('DELETE FROM users WHERE id = ?').run(id);
  },
};

// credential CRUD
export const Credentials = {
  byUserId(userId) {
    return db().prepare('SELECT * FROM credentials WHERE user_id = ?').all(userId);
  },
  byId(id) {
    return db().prepare('SELECT * FROM credentials WHERE id = ?').get(id);
  },
  create(c) {
    db().prepare(`INSERT INTO credentials
      (id, user_id, public_key, counter, device_type, transports, nickname, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      c.id, c.user_id, c.public_key, c.counter,
      c.device_type ?? null, JSON.stringify(c.transports ?? []),
      c.nickname ?? null, now());
  },
  updateCounter(id, counter) {
    db().prepare('UPDATE credentials SET counter = ? WHERE id = ?').run(counter, id);
  },
  remove(id) {
    db().prepare('DELETE FROM credentials WHERE id = ?').run(id);
  },
};

export const AuditLog = {
  recent(limit = 100) {
    return db().prepare(
      'SELECT a.*, u.username FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ?'
    ).all(limit);
  },
};
