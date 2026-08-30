import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Database = ReturnType<typeof createDatabase>["db"];

export function createDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    max: 10,
    prepare: false,
  });
  const db = drizzle(client, { schema });

  return {
    client,
    db,
    async close() {
      await client.end();
    },
  };
}

export * from "./schema.js";
