import type Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function ensureMigrationsTable(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
}

function getAppliedMigrations(sqlite: Database.Database): Set<string> {
  const rows = sqlite.prepare("SELECT name FROM schema_migrations").all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

export function runMigrations(sqlite: Database.Database, migrationsDir: string): void {
  ensureMigrationsTable(sqlite);

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  const applied = getAppliedMigrations(sqlite);
  const insertMigration = sqlite.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)");

  for (const fileName of files) {
    if (applied.has(fileName)) continue;
    const sql = readFileSync(join(migrationsDir, fileName), "utf-8");
    const tx = sqlite.transaction(() => {
      sqlite.exec(sql);
      insertMigration.run(fileName, Date.now());
    });
    tx();
  }
}
