import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ??
      "postgresql://mcp_wallet:mcp_wallet@localhost:5432/mcp_wallet",
  },
});
