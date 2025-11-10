import Database from "better-sqlite3";

console.log("🛠 Миграция: добавление поля character_role...");

const DB_PATH = process.env.DATABASE_URL || "./bot.db";
const db = new Database(DB_PATH);

function hasColumn(table: string, column: string): boolean {
  const stmt = db.prepare(`PRAGMA table_info(${table})`);
  const columns = stmt.all() as { name: string }[];
  return columns.some((col) => col.name === column);
}

if (!hasColumn("users", "character_role")) {
  console.log("➕ Добавляем колонку character_role...");
  db.exec(`ALTER TABLE users ADD COLUMN character_role TEXT DEFAULT NULL`);
  console.log("✅ Поле character_role успешно добавлено!");
} else {
  console.log("ℹ️ Поле character_role уже существует — пропускаем.");
}

db.close();
