// src/migrate_roles.ts
import Database from "better-sqlite3";

const DB_PATH = process.env.DATABASE_URL || "./bot.db";
const db = new Database(DB_PATH);

console.log("🚀 Миграция: добавляем роль system в таблицу messages...");

// 1. Переименовываем старую таблицу
db.exec(`ALTER TABLE messages RENAME TO messages_old;`);

// 2. Создаём новую с расширенным CHECK
db.exec(`
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  translated TEXT,
  ts INTEGER NOT NULL,
  FOREIGN KEY(chat_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

// 3. Переносим все данные
db.exec(`
INSERT INTO messages (id, chat_id, role, content, translated, ts)
SELECT id, chat_id, role, content, translated, ts
FROM messages_old;
`);

// 4. Удаляем старую таблицу
db.exec(`DROP TABLE messages_old;`);

console.log("✅ Миграция завершена. Теперь role поддерживает system.");
db.close();
