import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const database = createDatabase(databaseUrl);

try {
  await migrate(database.db, { migrationsFolder: "./drizzle" });
} finally {
  await database.close();
}
