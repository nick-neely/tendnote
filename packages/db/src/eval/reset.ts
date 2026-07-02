import postgres from "postgres";

const fallbackAdminUrl = "postgres://tendnote:tendnote@localhost:55432/tendnote";
const evalDatabaseName = process.env.TENDNOTE_EVAL_DATABASE_NAME ?? "tendnote_eval";

function baseAdminUrl() {
  const explicit = process.env.TENDNOTE_EVAL_ADMIN_DATABASE_URL;
  if (explicit) return explicit;

  return process.env.DATABASE_URL ?? fallbackAdminUrl;
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

async function resetEvalDatabase() {
  assertEvalDatabaseName(evalDatabaseName);

  const admin = postgres(baseAdminUrl(), {
    max: 1,
    prepare: false,
  });

  try {
    await admin`
      select pg_terminate_backend(pid)
      from pg_stat_activity
      where datname = ${evalDatabaseName}
        and pid <> pg_backend_pid()
    `;
    await admin.unsafe(`drop database if exists "${evalDatabaseName}"`);
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
