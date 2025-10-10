// src/migrations/migrate_orientation.ts
import Database from "better-sqlite3";

const DB_PATH = process.env.DATABASE_URL || "./bot.db";
const db = new Database(DB_PATH);

function hasColumn(table: string, column: string): boolean {
  const stmt = db.prepare(`PRAGMA table_info(${table})`);
  const columns = stmt.all() as { name: string }[];
  return columns.some((col) => col.name === column);
}

console.log("🛠 Проверка и добавление поля character_preference...");

if (!hasColumn("users", "character_preference")) {
  db.exec(`ALTER TABLE users ADD COLUMN character_preference TEXT DEFAULT NULL`);
  console.log("✅ Поле character_preference добавлено!");
} else {
  console.log("✅ Поле character_preference уже существует.");
}

db.close();
