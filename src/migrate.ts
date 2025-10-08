import Database from "better-sqlite3";

console.log("🛠 Запуск миграции базы...");

const DB_PATH = process.env.DATABASE_URL || "./bot.db";
const db = new Database(DB_PATH);

function hasColumn(table: string, column: string): boolean {
  const stmt = db.prepare(`PRAGMA table_info(${table})`);
  const columns = stmt.all() as { name: string }[];
  return columns.some((col) => col.name === column);
}

function migrate() {
  // === Premium ===
  if (!hasColumn("users", "premium")) {
    console.log("🛠 Добавляем колонку premium...");
    db.exec(`ALTER TABLE users ADD COLUMN premium INTEGER NOT NULL DEFAULT 0`);
  }

  // === Возраст ===
  if (!hasColumn("users", "age_verified")) {
    console.log("🛠 Добавляем колонку age_verified...");
    db.exec(
      `ALTER TABLE users ADD COLUMN age_verified INTEGER NOT NULL DEFAULT 0`
    );
  }

  // === Поля персонажа ===
  const characterFields = [
    "character_name",
    "character_gender",
    "character_age",
    "character_hair",
    "character_traits",
  ];

  for (const field of characterFields) {
    if (!hasColumn("users", field)) {
      console.log(`🛠 Добавляем поле ${field}...`);
      db.exec(`ALTER TABLE users ADD COLUMN ${field} TEXT DEFAULT NULL`);
    }
  }
}

migrate();

console.log("✅ Все миграции выполнены успешно.");
db.close();
