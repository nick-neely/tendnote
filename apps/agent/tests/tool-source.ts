import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Shared tool definitions a registration file may pull in, e.g. `../lib/tools/search-people`. */
const SHARED_TOOL_IMPORT = /from\s+"([^"]*\/lib\/tools\/[\w-]+)"/g;

/**
 * The source that actually defines a tool.
 *
 * A tool file used to be the whole implementation, so a scan could read one file and
 * know what the tool did. Four tools existed twice - once for the root agent, once
 * hand-copied into `relationship_strategist` - and the copies drifted until they had
 * lost safety clauses the originals still carried, so the definition moved to
 * `agent/lib/tools/` and both files became registrations of it.
 *
 * That leaves a registration file with no schema, no store call, and no error wrapper
 * in it: a scan reading it alone would find nothing to object to and pass for the
 * wrong reason. This returns the registration plus every shared definition it
 * registers, which is what those scans always meant by "the tool".
 */
export function effectiveToolSource(path: string): string {
  const source = readFileSync(path, "utf8");
  const shared = [...source.matchAll(SHARED_TOOL_IMPORT)]
    .map((match) => resolve(dirname(path), `${match[1]}.ts`))
    .filter((sharedPath) => existsSync(sharedPath))
    .map((sharedPath) => readFileSync(sharedPath, "utf8"));

  return [source, ...shared].join("\n");
}
