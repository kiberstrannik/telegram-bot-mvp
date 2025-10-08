import Database from "better-sqlite3";

/* ===========================
   TYPES
   =========================== */
export type Role = "user" | "assistant" | "system";

export type CharacterProfile = {
  character_name?: string | null;
  character_gender?: string | null;
  character_age?: string | null;
  character_hair?: string | null;
  character_traits?: string | null;
};

/* ===========================
   DB INIT
   =========================== */
const DB_PATH = process.env.DATABASE_URL || "./bot.db";
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000),
  premium INTEGER NOT NULL DEFAULT 0,
  age_verified INTEGER NOT NULL DEFAULT 0,
  character_name TEXT DEFAULT NULL,
  character_gender TEXT DEFAULT NULL,
  character_age TEXT DEFAULT NULL,
  character_hair TEXT DEFAULT NULL,
  character_traits TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  translated TEXT,
  ts INTEGER NOT NULL,
  FOREIGN KEY(chat_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages(chat_id, ts);
`);

/* ===========================
   USERS
   =========================== */
export async function upsertUser(
  id: number,
  username?: string | null,
  first_name?: string | null,
  last_name?: string | null
) {
  const ins = db.prepare(`
    INSERT INTO users (id, username, first_name, last_name, created_at)
    VALUES (@id, @username, @first_name, @last_name, @created_at)
    ON CONFLICT(id) DO UPDATE SET
      username=excluded.username,
      first_name=excluded.first_name,
      last_name=excluded.last_name
  `);

  ins.run({
    id,
    username: username ?? null,
    first_name: first_name ?? null,
    last_name: last_name ?? null,
    created_at: Date.now(),
  });
}

/* ===========================
   PREMIUM & AGE
   =========================== */
export async function setPremium(chatId: number, isPremium: boolean) {
  db.prepare(`UPDATE users SET premium = ? WHERE id = ?`).run(isPremium ? 1 : 0, chatId);
}

export async function isPremium(chatId: number): Promise<boolean> {
  const row = db.prepare(`SELECT premium FROM users WHERE id = ?`).get(chatId) as { premium?: number };
  return row?.premium === 1;
}

export async function setAgeVerified(chatId: number, value: number) {
  db.prepare(`UPDATE users SET age_verified = ? WHERE id = ?`).run(value, chatId);
}

export async function getAgeVerified(chatId: number): Promise<number> {
  const row = db.prepare(`SELECT age_verified FROM users WHERE id = ?`).get(chatId) as { age_verified?: number };
  return row?.age_verified ?? 0;
}

/* ===========================
   CHARACTER
   =========================== */
export function updateCharacterField(userId: number, key: keyof CharacterProfile, value: string) {
  const stmt = db.prepare(`UPDATE users SET ${key} = ? WHERE id = ?`);
  stmt.run(value, userId);
}

export function getCharacterProfile(userId: number): CharacterProfile {
  const stmt = db.prepare(`
    SELECT character_name, character_gender, character_age, character_hair, character_traits
    FROM users WHERE id = ?
  `);
  return stmt.get(userId) || {};
}

/* ===========================
   MESSAGES
   =========================== */
export async function addMessage(chatId: number, role: Role, content: string, translated?: string) {
  db.prepare(
    `INSERT INTO messages (chat_id, role, content, translated, ts)
     VALUES (?, ?, ?, ?, ?)`
  ).run(chatId, role, content, translated ?? null, Date.now());
}

export async function getHistory(chatId: number, limit = 60): Promise<{ role: Role; content: string; translated?: string | null }[]> {
  const rows = db.prepare(`
    SELECT role, content, translated FROM messages
    WHERE chat_id = ? ORDER BY ts ASC LIMIT ?
  `).all(chatId, limit) as { role: Role; content: string; translated?: string | null }[];

  return rows;
}

export async function resetUser(chatId: number) {
  db.prepare(`DELETE FROM messages WHERE chat_id = ?`).run(chatId);
}

export async function exportMessages(chatId: number) {
  const rows = db.prepare(`
    SELECT role, content, translated, ts FROM messages
    WHERE chat_id = ? ORDER BY ts ASC
  `).all(chatId);
  return { chat_id: chatId, count: rows.length, messages: rows };
}

export async function getMessageCount(chatId: number): Promise<number> {
  const row = db.prepare(`SELECT COUNT(*) as count FROM messages WHERE chat_id = ?`).get(chatId) as { count: number };
  return row.count;
}

export async function rollbackLastStep(chatId: number, steps = 2) {
  db.prepare(`
    DELETE FROM messages WHERE id IN (
      SELECT id FROM messages WHERE chat_id = ? ORDER BY ts DESC LIMIT ?
    )
  `).run(chatId, steps);
}

export default db;
