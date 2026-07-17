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

export function resolveDatabaseDriver(input: {
  databaseUrl: string;
  configuredDriver?: string;
}): "postgres" {
  // The URL is intentionally part of this public configuration seam so a future
  // adapter can make an explicit, tested choice. Hostname heuristics are forbidden:
  // Neon supports regular Postgres connections, and choosing neon-http from the host
  // silently disabled every lifecycle path that relies on interactive transactions.
  void input.databaseUrl;
  const configured = input.configuredDriver?.trim();

  if (!configured || configured === "postgres") {
    return "postgres";
  }
  if (configured === "neon-http") {
    throw new Error(
      "DATABASE_DRIVER=neon-http does not support the transactions required by Tendnote. Use DATABASE_DRIVER=postgres or leave it unset.",
    );
  }

  throw new Error(`Unsupported DATABASE_DRIVER: ${configured}. Expected postgres.`);
}

export function hasDatabaseUrl() {
  return Boolean(getDatabaseUrl());
}

export function getDb(): Database {
  const url = getDatabaseUrl();

  if (!db) {
    resolveDatabaseDriver({
      databaseUrl: url,
      configuredDriver: process.env.DATABASE_DRIVER,
    });
    postgresClient = postgres(url, {
      max: 5,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
    });
    db = drizzlePostgres(postgresClient, { schema });
  }

  return db;
}

export async function closeDb() {
  await postgresClient?.end();
  postgresClient = undefined;
  db = undefined;
}
