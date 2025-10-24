import Database from "better-sqlite3";

/* ===========================
   TYPES
   =========================== */
export type Role = "user" | "assistant" | "system";

export type CharacterProfile = {
  character_name: string;
  character_gender: string;
  character_age: string;
  character_race: string;
  character_preference?: string;
};


/* ===========================
   INIT DATABASE
   =========================== */
const db = new Database("data.db");

// создаём таблицы, если их нет
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
  character_race TEXT,
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
  // ✅ Защита от SQL-инъекций — разрешаем только эти поля
  const allowed = [
  "character_name",
  "character_gender",
  "character_age",
  "character_race",
  "character_preference",
  ];
  if (!allowed.includes(field)) {
    throw new Error(`Недопустимое поле: ${field}`);
  }

  // ✅ Проверяем, есть ли пользователь в базе
  const userExists = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!userExists) {
    db.prepare("INSERT INTO users (id) VALUES (?)").run(userId);
  }

  // ✅ Обновляем конкретное поле
  const stmt = db.prepare(`UPDATE users SET ${field} = ? WHERE id = ?`);
  stmt.run(value, userId);
}

export function getCharacterProfile(userId: number): CharacterProfile | null {
  const stmt = db.prepare(`
    SELECT
      character_name,
      character_gender,
      character_age,
      character_race,
      character_preference
    FROM users
    WHERE id = ?
  `);

  const row = stmt.get(userId) as CharacterProfile | undefined;

  // ✅ Если строка отсутствует — возвращаем null
  if (!row) return null;

  // ✅ Возвращаем объект даже если часть полей пустая
  return {
    character_name: row.character_name || "",
    character_gender: row.character_gender || "",
    character_age: row.character_age || "",
    character_race: row.character_race || "",
    character_preference: row.character_preference || "",
  };
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
  const stmt1 = db.prepare(`DELETE FROM messages WHERE user_id = ?`);
  const stmt2 = db.prepare(`
    UPDATE users SET
      character_name = NULL,
      character_gender = NULL,
      character_age = NULL,
      character_race = NULL,
      character_preference = NULL
    WHERE id = ?;
  `);
  stmt1.run(userId);
  stmt2.run(userId);
}
