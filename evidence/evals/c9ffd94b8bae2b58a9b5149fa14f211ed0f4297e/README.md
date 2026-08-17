# Pre-publication deterministic evaluation gate — non-clean run

- **Source commit:** `c9ffd94b8bae2b58a9b5149fa14f211ed0f4297e`
- **Workflow:** [Run Eve model evaluations #31994857888](https://github.com/nick-neely/tendnote/actions/runs/31994857888), manually dispatched from `docs/phase-9a-wayfinder`
- **Execution:** 2026-08-17 04:32:49–04:34:24 UTC
- **Configuration:** the workflow supplied `AI_GATEWAY_API_KEY` and ran `pnpm --filter @tendnote/agent eval:deterministic`; no model invocation or evaluated-case result was reached.
- **Outcome:** failed before the deterministic suite could produce a gradable JSON summary. No JUnit XML, result JSON, or GitHub artifact exists for this run.

The prepared eval database migrated and seeded successfully. Eve then failed while
loading its authored runtime because the generated module could not resolve the
workspace dependency `drizzle-orm`:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'drizzle-orm' imported from
apps/agent/.eve/dev-runtime/snapshots/.../source/apps/agent/.eve/compile/authored-modules/....mjs
```

The deterministic wrapper consequently reported `Error: Eve did not produce a
JSON eval summary.` The workflow's `Upload Eve evaluation artifacts` step found
no files at `apps/agent/.eve/evals/`; the complete redacted runner log remains
at the immutable workflow-run link above.

This is **not** an evaluation result: zero cases were graded, so the Phase 9a
publication gate remains blocked. The follow-up decision ticket created from
this run must classify the Eve workspace-module resolution failure and decide
the remediation and next-run evidence shape. This evidence deliberately does
not rerun or repair the suite.
