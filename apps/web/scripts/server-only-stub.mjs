import { registerHooks } from "node:module";

// `server-only` resolves only inside Next's server bundle. The operator CLI runs
// the same server modules under plain Node, so the guard becomes an empty
// module. Synchronous hooks apply to `require` as well as `import`.
const STUB = "tendnote:server-only";

registerHooks({
  resolve(specifier, context, next) {
    return specifier === "server-only"
      ? { url: STUB, shortCircuit: true }
      : next(specifier, context);
  },
  load(url, context, next) {
    return url === STUB
      ? { format: "commonjs", source: "", shortCircuit: true }
      : next(url, context);
  },
});
