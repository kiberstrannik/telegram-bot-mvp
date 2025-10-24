import Database from "better-sqlite3";

console.log("🚀 Миграция: добавляем поле character_race в таблицу users...");

const DB_PATH = process.env.DATABASE_URL || "./bot.db";
const db = new Database(DB_PATH);

function hasColumn(table: string, column: string): boolean {
  const stmt = db.prepare(`PRAGMA table_info(${table});`);
  const columns = stmt.all() as { name: string }[];
  return columns.some((col) => col.name === column);
}

try {
  if (!hasColumn("users", "character_race")) {
    db.exec(`ALTER TABLE users ADD COLUMN character_race TEXT DEFAULT NULL;`);
    console.log("✅ Поле character_race успешно добавлено.");
  } else {
    console.log("ℹ️ Поле character_race уже существует. Миграция пропущена.");
  }
} catch (err) {
  console.error("❌ Ошибка при добавлении поля character_race:", err);
}

db.close();
console.log("🏁 Миграция завершена.");
