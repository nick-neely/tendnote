import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { assertEvalDatabase, models, variants } from "./plan.mjs";

function atomicBytes(path, bytes) {
  const fd = openSync(`${path}.tmp`, "w", 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(`${path}.tmp`, path);
  const directory = openSync(resolve(path, ".."), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}
export function atomicJson(path, value) {
  atomicBytes(path, `${JSON.stringify(value, null, 2)}\n`);
}
export function assertNoReplayWorkers(app) {
  const prefix = join(app, ".eve", "cost-replay-");
  for (const pid of readdirSync("/proc").filter((entry) => /^\d+$/.test(entry))) {
    let cwd;
    try {
      cwd = readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      continue;
    }
    if (cwd.startsWith(prefix))
      throw new Error(`Replay worker ${pid} is still alive; refuse database reset/restore`);
  }
}
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function settledRows(ledger) {
  if (
    !Array.isArray(ledger.rows) ||
    ledger.rows.some((r) => r.status !== "settled" || !Number.isFinite(r.costUsd) || r.costUsd < 0)
  )
    throw new Error(
      "Resume requires every previous request to be settled; reconcile uncertain billing first",
    );
  return ledger.rows;
}
function checkpointContract() {
  const migrations = resolve(import.meta.dirname, "../../../../packages/db/migrations");
  const files = readdirSync(migrations, { recursive: true })
    .filter((name) => /\.(sql|json)$/.test(name))
    .sort();
  const schemaSha256 = digest(
    Buffer.concat(
      files.map((name) => Buffer.concat([Buffer.from(name), readFileSync(join(migrations, name))])),
    ),
  );
  return {
    schemaSha256,
    revision: "capture-contract-v2",
    workload: variants.heavy,
    models,
    days: 30,
  };
}
export function saveCheckpoint({ root, day, progress, fixture, dump, runId, source, ledgerRows }) {
  if (
    !Number.isInteger(day) ||
    day < 1 ||
    day > 30 ||
    progress.turns !== day * 20 ||
    progress.storage?.unfinishedBackgroundJobs !== 0
  )
    throw new Error("Checkpoint requires a complete, quiescent heavy day");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  settledRows({ rows: ledgerRows });
  const file = `day-${String(day).padStart(2, "0")}-${randomUUID()}.dump`;
  const bytes = dump();
  atomicBytes(join(root, file), bytes);
  const checkpoint = {
    billingPrefix: { count: ledgerRows.length, sha256: digest(JSON.stringify(ledgerRows)) },
    version: 1,
    day,
    progress,
    fixture,
    runId,
    source,
    contract: checkpointContract(),
    databaseFile: file,
    sha256: digest(bytes),
    createdAt: new Date().toISOString(),
  };
  // Publish only after the database snapshot is durable. Keep older days intact.
  atomicJson(join(root, `day-${String(day).padStart(2, "0")}.json`), checkpoint);
  atomicJson(join(root, "latest.json"), checkpoint);
  return checkpoint;
}
export function loadCheckpoint(root) {
  const checkpoint = JSON.parse(readFileSync(join(root, "latest.json"), "utf8"));
  if (
    checkpoint.version !== 1 ||
    JSON.stringify(checkpoint.contract) !== JSON.stringify(checkpointContract())
  )
    throw new Error("Checkpoint workload/models are incompatible");
  if (
    !Number.isInteger(checkpoint.day) ||
    checkpoint.day < 1 ||
    checkpoint.day > 30 ||
    checkpoint.progress.turns !== checkpoint.day * 20 ||
    checkpoint.progress.storage?.unfinishedBackgroundJobs !== 0
  )
    throw new Error("Invalid checkpoint day or unfinished work");
  if (
    !new RegExp(`^day-${String(checkpoint.day).padStart(2, "0")}-[a-f0-9-]{36}\\.dump$`).test(
      checkpoint.databaseFile,
    )
  )
    throw new Error("Invalid checkpoint database path");
  const bytes = readFileSync(join(root, checkpoint.databaseFile));
  if (digest(bytes) !== checkpoint.sha256) throw new Error("Checkpoint database digest mismatch");
  const attempt = JSON.parse(readFileSync(join(root, "attempt.json"), "utf8"));
  const metadata = JSON.parse(readFileSync(join(attempt.output, "metadata.json"), "utf8"));
  if (
    metadata.runId !== checkpoint.runId ||
    metadata.ceilingUsd !== 50 ||
    metadata.mode !== "--heavy"
  )
    throw new Error("Checkpoint attempt identity/budget mismatch");
  const ledger = JSON.parse(readFileSync(join(attempt.output, "ledger.json"), "utf8"));
  const rows = settledRows(ledger);
  const prefix = checkpoint.billingPrefix;
  if (
    !prefix ||
    rows.length < prefix.count ||
    digest(JSON.stringify(rows.slice(0, prefix.count))) !== prefix.sha256
  )
    throw new Error("Checkpoint billing history was truncated or changed");
  const reportQuerySpendUsd = previousQuerySpend(metadata, attempt.output);
  return {
    checkpoint,
    bytes,
    rows,
    reportQuerySpendUsd,
    previousOutput: resolve(attempt.output),
    root: resolve(root),
  };
}

function previousQuerySpend(metadata, output) {
  const reportQuerySpendUsd =
    (metadata.reportQuerySpendUsd ?? 0) +
    (existsSync(join(output, "provider-report.json"))
      ? (metadata.reportQueryAllowanceUsd ?? 0.005)
      : 0);
  if (!Number.isFinite(reportQuerySpendUsd) || reportQuerySpendUsd < 0)
    throw new Error("Invalid reporting fee history");
  return reportQuerySpendUsd;
}

// Use the existing local eval Postgres container; never accept a remote database.
export function evalDatabaseArchive(database, container = "tendnote-postgres") {
  const url = new URL(assertEvalDatabase(database));
  const ports = execFileSync("docker", ["port", container, "5432/tcp"], {
    encoding: "utf8",
  });
  if (
    !ports
      .split("\n")
      .some((line) =>
        [
          `127.0.0.1:${url.port || "5432"}`,
          `0.0.0.0:${url.port || "5432"}`,
          `[::]:${url.port || "5432"}`,
        ].includes(line),
      )
  )
    throw new Error("Eval database is not the expected loopback Docker port");
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) };
  const base = ["exec", "-i", "-e", "PGPASSWORD", container];
  const connection = ["-U", decodeURIComponent(url.username), "-d", "tendnote_eval"];
  return {
    assertQuiescent: () => {
      const query = `select count(*) from (
        select j.status::text from extraction_jobs j join source_records s on s.id=j.source_record_id where s.owner_user_id='cost-replay-user'
        union all select j.status::text from action_extraction_jobs j join source_records s on s.id=j.source_record_id where s.owner_user_id='cost-replay-user'
        union all select status::text from context_fact_extraction_jobs where owner_user_id='cost-replay-user'
        union all select status::text from relationship_context_embedding_jobs where owner_user_id='cost-replay-user'
      ) jobs where status not in ('completed','skipped')`;
      const count = execFileSync("docker", [...base, "psql", ...connection, "-Atc", query], {
        env,
        encoding: "utf8",
      }).trim();
      if (count !== "0")
        throw new Error("Database still has unfinished jobs after child exit; checkpoint refused");
    },
    dump: () =>
      execFileSync("docker", [...base, "pg_dump", ...connection, "-Fc"], {
        env,
        maxBuffer: 128 * 1024 * 1024,
      }),
    restore: (bytes) =>
      execFileSync(
        "docker",
        [
          ...base,
          "pg_restore",
          ...connection,
          "--clean",
          "--if-exists",
          "--exit-on-error",
          "--single-transaction",
        ],
        { env, input: bytes, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 128 * 1024 * 1024 },
      ),
  };
}
