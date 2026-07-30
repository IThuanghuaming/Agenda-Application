import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(currentDirectory, "../..");
const dataDirectory = path.join(serverRoot, "data");
const databasePath = path.join(dataDirectory, "tasks.db");
const schemaPath = path.join(serverRoot, "src", "database", "schema.sql");

fs.mkdirSync(dataDirectory, { recursive: true });

export const database = new Database(databasePath);
database.pragma("journal_mode = WAL");
database.pragma("foreign_keys = ON");
database.exec(fs.readFileSync(schemaPath, "utf8"));

export { databasePath };