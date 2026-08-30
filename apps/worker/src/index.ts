import { createDatabase } from "@mcp-wallet/db";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const database = createDatabase(databaseUrl);
let stopped = false;

async function verifyConnection() {
  await database.client`select 1`;
  console.info(JSON.stringify({ level: "info", service: "worker", event: "database_ready" }));
}

async function shutdown(signal: string) {
  if (stopped) return;
  stopped = true;
  console.info(JSON.stringify({ level: "info", service: "worker", event: "shutdown", signal }));
  await database.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await verifyConnection();

while (!stopped) {
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  await verifyConnection();
}
