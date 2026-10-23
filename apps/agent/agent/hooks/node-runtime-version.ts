import { version } from "node:process";
import { defineHook } from "eve/hooks";

// Eve loads hook modules at runtime startup, separately from the Next.js service.
// Do not add agent/instrumentation.ts: its presence enables Eve telemetry.
const runtimeVersionLogged = Symbol.for("tendnote.eve.node-runtime-version");
const runtime = globalThis as Record<symbol, boolean | undefined>;
if (!runtime[runtimeVersionLogged]) {
  runtime[runtimeVersionLogged] = true;
  try {
    console.info("runtime.node_version", { service: "eve", nodeVersion: version });
  } catch {
    // Logging must never prevent Eve startup.
  }
}

// No event subscribers: requests, turns, and model calls do not emit diagnostics.
export default defineHook({ events: {} });
