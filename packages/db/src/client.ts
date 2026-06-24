import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Database = ReturnType<typeof drizzlePostgres<typeof schema>>;

let db: Database | undefined;
let postgresClient: postgres.Sql | undefined;

const localDatabaseUrl = "postgres://tendnote:tendnote@localhost:55432/tendnote";

function getDatabaseUrl() {
  return process.env.DATABASE_URL ?? localDatabaseUrl;
}

function shouldUseNeonHttp(url: string) {
  return (
    process.env.DATABASE_DRIVER === "neon-http" ||
    (url.includes("neon.tech") && process.env.DATABASE_DRIVER !== "postgres")
  );
}

export function hasDatabaseUrl() {
  return Boolean(getDatabaseUrl());
}

export function getDb(): Database {
  const url = getDatabaseUrl();

  if (!db) {
    if (shouldUseNeonHttp(url)) {
      db = drizzleNeon(neon(url), { schema }) as unknown as Database;
    } else {
      postgresClient = postgres(url, {
        max: 5,
        prepare: false,
      });
      db = drizzlePostgres(postgresClient, { schema });
    }
  }

  return db;
}

export async function closeDb() {
  await postgresClient?.end();
  postgresClient = undefined;
  db = undefined;
}
