// src/db.ts
import Database from "better-sqlite3";

/* ===========================
   TYPES
   =========================== */
export type Role = "user" | "assistant" | "system";

export type CharacterProfile = {
  character_name: string;
  character_gender: string;
  character_age: string;
  character_hair: string;
  character_traits: string;
  character_preference?: string;
};

/* ===========================
   INIT DATABASE
   =========================== */
const db = new Database("data.db");

// Создаём таблицы, если их нет
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  premium INTEGER DEFAULT 0,
  age_verified INTEGER DEFAULT 0,
  character_name TEXT,
  character_gender TEXT,
  character_age TEXT,
  character_hair TEXT,
  character_traits TEXT,
  character_preference TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  role TEXT,
  content TEXT,
  translated TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

/* ===========================
   USER MANAGEMENT
   =========================== */
export function upsertUser(
  id: number,
  username?: string,
  first_name?: string,
  last_name?: string
) {
  const stmt = db.prepare(`
    INSERT INTO users (id, username, first_name, last_name)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      last_name = excluded.last_name;
  `);
  stmt.run(id, username, first_name, last_name);
}

export function isPremium(userId: number): boolean {
  const stmt = db.prepare(`SELECT premium FROM users WHERE id = ?`);
  const row = stmt.get(userId) as { premium?: number } | undefined;
  return !!row?.premium;
}

export function getMessageCount(userId: number): number {
  const stmt = db.prepare(`SELECT COUNT(*) as count FROM messages WHERE user_id = ?`);
  const row = stmt.get(userId) as { count: number };
  return row.count;
}

export function getAgeVerified(userId: number): number {
  const stmt = db.prepare(`SELECT age_verified FROM users WHERE id = ?`);
  const row = stmt.get(userId) as { age_verified?: number } | undefined;
  return row?.age_verified ?? 0;
}

/* ===========================
   CHARACTER PROFILE
   =========================== */
export function updateCharacterField(
  userId: number,
  field: keyof CharacterProfile,
  value: string
) {
  const stmt = db.prepare(`UPDATE users SET ${field} = ? WHERE id = ?`);
  stmt.run(value, userId);
}

export function getCharacterProfile(userId: number): CharacterProfile | null {
  const stmt = db.prepare(`
    SELECT
      character_name,
      character_gender,
      character_age,
      character_hair,
      character_traits,
      character_preference
    FROM users WHERE id = ?
  `);
  const row = stmt.get(userId) as CharacterProfile | undefined;
  return row || null;
}

/* ===========================
   MESSAGES
   =========================== */
export function addMessage(
  userId: number,
  role: Role,
  content: string,
  translated?: string
) {
  const stmt = db.prepare(`
    INSERT INTO messages (user_id, role, content, translated)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(userId, role, content, translated || content);
}

export function getHistory(userId: number): { role: Role; content: string }[] {
  const stmt = db.prepare(`
    SELECT role, translated AS content
    FROM messages
    WHERE user_id = ?
    ORDER BY id ASC
  `);
  return stmt.all(userId) as { role: Role; content: string }[];
}

export function resetUser(userId: number) {
  const stmt = db.prepare(`DELETE FROM messages WHERE user_id = ?`);
  stmt.run(userId);
}
