#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The credential gate for every eval suite that drives a live model.
 *
 * "Deterministic" in `eve eval --tag deterministic` means *no judge* — the agent itself is
 * still a real model behind the AI Gateway, so these evals need a gateway credential like any
 * other. Without one, `eve` fails deep inside the run with "model provider not linked", which
 * reads like a broken eval rather than a missing key.
 *
 * So the gate resolves the two environments differently, and never quietly:
 *
 * - **Locally**, a missing credential is a *loud skip*: the suite is not runnable, the
 *   developer is told exactly why and how to fix it, and the command exits 0 so a full
 *   `pnpm verify` on a laptop without gateway access is not blocked by evals it cannot run.
 * - **In CI** (`CI` is set), a missing credential is a *hard failure*. CI is where these evals
 *   are enforced, and a skip there would turn an unset secret into a green build — exactly the
 *   silent pass this gate exists to prevent.
 *
 * Exit codes, which the calling script branches on: 0 = credentials present, run the suite;
 * 2 = skip (local, loud); 1 = fail (CI).
 */

const SUITE = process.argv[2] ?? "Eve";
const KEYS = ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"];

/** `eve` loads `apps/agent/.env.local` itself, so a key there counts as present. */
function hasCredentialInEnvFile() {
  const envFile = join(process.cwd(), ".env.local");
  if (!existsSync(envFile)) {
    return false;
  }

  const contents = readFileSync(envFile, "utf8");
  // A declared-but-empty key (`AI_GATEWAY_API_KEY=`) is not a credential.
  return KEYS.some((key) => new RegExp(`^\\s*${key}\\s*=\\s*\\S`, "m").test(contents));
}

function hasCredential() {
  return KEYS.some((key) => (process.env[key] ?? "").trim().length > 0) || hasCredentialInEnvFile();
}

if (hasCredential()) {
  process.exit(0);
}

if (process.env.CI) {
  console.error(
    `\nFAILED: the ${SUITE} Eve evals drive a live model and no gateway credential is set.\n` +
      `Set ${KEYS.join(" or ")} in CI — skipping here would let an unset secret pass as green.\n`,
  );
  process.exit(1);
}

console.warn(
  `\n${"=".repeat(78)}\n` +
    `SKIPPING the ${SUITE} Eve evals: no ${KEYS.join(" or ")}.\n` +
    `These evals drive a live model through the AI Gateway. They are NOT being run, and\n` +
    `they ARE enforced in CI. To run them here, put a key in apps/agent/.env.local.\n` +
    `${"=".repeat(78)}\n`,
);
process.exit(2);
