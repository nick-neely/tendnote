import postgres from "postgres";

const fallbackAdminUrl = "postgres://tendnote:tendnote@localhost:55432/tendnote";
const evalDatabaseName = process.env.TENDNOTE_EVAL_DATABASE_NAME ?? "tendnote_eval";

function baseAdminUrl() {
  const explicit = process.env.TENDNOTE_EVAL_ADMIN_DATABASE_URL;
  if (explicit) return explicit;

  const candidate = process.env.DATABASE_URL ?? fallbackAdminUrl;
  const url = new URL(candidate);

  // Retry runners execute with DATABASE_URL pointed at the eval database. A
  // database cannot drop itself, so use PostgreSQL's maintenance database for
  // the guarded reset when that happens.
  if (url.pathname === `/${evalDatabaseName}`) {
    url.pathname = "/postgres";
    return url.toString();
  }

  return candidate;
}

function evalDatabaseUrl() {
  const explicit = process.env.TENDNOTE_EVAL_DATABASE_URL;
  if (explicit) return explicit;

  const url = new URL(baseAdminUrl());
  url.pathname = `/${evalDatabaseName}`;
  return url.toString();
}

function assertEvalDatabaseName(name: string) {
  if (!/^tendnote_eval[a-z0-9_-]*$/.test(name)) {
    throw new Error(
      `Refusing to reset non-eval database "${name}". Use a name beginning with tendnote_eval.`,
    );
  }
}

const DROP_RETRY_ATTEMPTS = 8;
const DROP_RETRY_DELAY_MS = 250;

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function shouldRetryDrop(error: unknown, attempt: number) {
  return (error as { code?: string }).code === "55006" && attempt < DROP_RETRY_ATTEMPTS;
}

async function dropEvalDatabase(admin: ReturnType<typeof postgres>) {
  for (let attempt = 1; attempt <= DROP_RETRY_ATTEMPTS; attempt += 1) {
    await admin`
      select pg_terminate_backend(pid)
      from pg_stat_activity
      where datname = ${evalDatabaseName}
        and pid <> pg_backend_pid()
    `;

    try {
      await admin.unsafe(`drop database if exists "${evalDatabaseName}"`);
      return;
    } catch (error) {
      if (!shouldRetryDrop(error, attempt)) throw error;
      await delay(DROP_RETRY_DELAY_MS);
    }
  }
}

async function resetEvalDatabase() {
  assertEvalDatabaseName(evalDatabaseName);

  const admin = postgres(baseAdminUrl(), {
    max: 1,
    prepare: false,
  });

  try {
    // Eve's local runtime can still be closing a workflow connection after the
    // eval process exits. Re-terminate and retry only the guarded eval database
    // while that short shutdown race settles.
    await dropEvalDatabase(admin);
    await admin.unsafe(`create database "${evalDatabaseName}"`);
  } finally {
    await admin.end();
  }

  console.log(`Reset eval database ${evalDatabaseName}.`);
  console.log(`DATABASE_URL=${evalDatabaseUrl()}`);
}

resetEvalDatabase().catch((error) => {
  console.error(error);
  process.exit(1);
});
