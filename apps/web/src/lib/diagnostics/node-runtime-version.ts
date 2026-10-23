import "server-only";

const runtimeVersionLogged = Symbol.for("tendnote.web.node-runtime-version");

export function logNodeRuntimeVersion() {
  const runtime = globalThis as Record<symbol, boolean | undefined>;
  if (runtime[runtimeVersionLogged]) return;
  runtime[runtimeVersionLogged] = true;
  try {
    console.info("runtime.node_version", { service: "web", nodeVersion: process.version });
  } catch {
    // A diagnostic must never prevent the server from starting.
  }
}
