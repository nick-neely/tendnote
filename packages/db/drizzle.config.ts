import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://tendnote:tendnote@localhost:55432/tendnote",
  },
  casing: "snake_case",
  strict: true,
  verbose: true,
});
