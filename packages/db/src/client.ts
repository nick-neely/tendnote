import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof drizzlePostgres<typeof schema>>;

/**
 * Whatever a query may be issued against: the pooled database, or one open
 * transaction. Adapters that must be re-bindable to a transaction take a
 * `() => DatabaseExecutor` instead of calling {@link getDb} directly, so the
 * same code reads inside and outside a transaction.
 */
export type DatabaseExecutor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

let db: Database | undefined;
let postgresClient: postgres.Sql | undefined;
const transactionContext = new AsyncLocalStorage<DatabaseExecutor>();

const localDatabaseUrl = "postgres://tendnote:tendnote@localhost:55432/tendnote";

function getDatabaseUrl() {
  return process.env.DATABASE_URL ?? localDatabaseUrl;
}

export function resolveDatabaseDriver(input: { configuredDriver?: string }): "postgres" {
  // Hostname heuristics are forbidden: Neon supports regular Postgres connections,
  // and choosing neon-http from the host silently disabled every lifecycle path that
  // relies on interactive transactions.
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
  const transaction = transactionContext.getStore();
  if (transaction) {
    // Transaction executors expose the query surface used by stores. Keep the
    // root Database type here so adapters need not branch at every statement.
    return transaction as Database;
  }
  const url = getDatabaseUrl();

  if (!db) {
    resolveDatabaseDriver({
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

/** Keeps every nested store call in one commit or rollback boundary. */
export async function withDatabaseTransaction<T>(fn: () => Promise<T>): Promise<T> {
  if (transactionContext.getStore()) {
    return fn();
  }
  return getDb().transaction((tx) => transactionContext.run(tx, fn));
}

export async function closeDb() {
  await postgresClient?.end();
  postgresClient = undefined;
  db = undefined;
}
