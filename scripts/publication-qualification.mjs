#!/usr/bin/env node

import { resolve } from "node:path";
import { main } from "./publication-qualification/cli.mjs";

/**
 * Phase 9a publication qualification.
 *
 * The contract is fail-closed: a report is qualified only when every gate in
 * `publication-qualification/contract.mjs` reports every one of its criteria
 * passed, with exact evidence tied to the candidate commit and no blockers.
 * This file is only the entry point; each part of the contract lives in its
 * own module beside it:
 *
 * - `contract.mjs`          the closed gate/criterion list and shared predicates
 * - `normalization.mjs`     compose a report from raw gate results
 * - `report-validation.mjs` re-derive a serialized report's verdict
 * - `evidence-bundle.mjs`   verify a deterministic Eve evidence bundle
 * - `evidence-files.mjs`    verify evidence bytes against the candidate commit
 * - `canonical-origin.mjs`  read-only HTTPS origin and redirect check
 * - `report-output.mjs`     atomic, sandboxed report writing
 * - `junit.mjs` / `secure-fs.mjs`  strict JUnit and symlink-refusing reads
 */

export { verifyCanonicalOrigin } from "./publication-qualification/canonical-origin.mjs";
export { main } from "./publication-qualification/cli.mjs";
export {
  CANONICAL_ORIGIN,
  FORMER_ORIGIN,
  QUALIFICATION_BINDINGS,
  QUALIFICATION_GATES,
  QUALIFICATION_KIND,
  QUALIFICATION_SCHEMA_VERSION,
  REPOSITORY,
} from "./publication-qualification/contract.mjs";
export { verifyDeterministicEvidenceBundle } from "./publication-qualification/evidence-bundle.mjs";
export { verifyEvidenceFiles } from "./publication-qualification/evidence-files.mjs";
export { composeQualificationReport } from "./publication-qualification/normalization.mjs";
export { validateQualificationReport } from "./publication-qualification/report-validation.mjs";

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
