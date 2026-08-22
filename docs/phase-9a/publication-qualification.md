# Phase 9a publication qualification

`#488` owns one final, exact-candidate release contract. The report is a
decision record, not a claim that the repository is public and not permission
to send anything outside the repository.

## Entry point

Run the top-level report composer from a checkout whose `HEAD` is the candidate
commit:

```sh
pnpm publication:qualification \
  --candidate-sha "$(git rev-parse HEAD)" \
  --input /path/to/phase-9a-gate-results.json \
  --output evidence/qualification/$(git rev-parse HEAD)/report.json
```

The input contains one result for every gate in
[`publication-qualification.schema.json`](publication-qualification.schema.json).
The command refuses a different checkout or a different input SHA. Without an
input file it emits a blocked report with every gate `not-run`; that default is
deliberately not useful as a release shortcut.

The command exits zero only when every required gate and every listed criterion
is `passed`. `pending`, `failed`, `skipped`, `recovered`, `stale`, `not-run`, an
unknown status, missing evidence, a mismatched source SHA, or a checksum
disagreement is blocking. There is no warning state that can be mistaken for a
qualification pass.

## Composed proof surfaces

The entry point composes the existing proof owners; it does not reimplement
their product behavior.

| Report gate | Existing proof or observation | Required final property |
| --- | --- | --- |
| Repository readiness | `pnpm publication:check`, tracked legal and attribution files | The current tree is distributable and has no maintainer-specific configuration. |
| Live governance | CLA Assistant proof, #494 fork-PR approval proof, GitHub PVR setting | Live owner-controlled governance is observed, not inferred from a manifest. |
| Self-Hosted Admission | `packages/domain/src/admission.test.ts`, `scripts/self-hosted-runbook.test.ts`, Web Instant admission contracts | Owner, pending, concurrency, invitation, invalid configuration, Flags failure, and shared Web/Eve decisions all pass. |
| Owner Data Export | `packages/db/src/queries/owner-data-export/qualification.test.ts`, Account journey tests | The complete archive, isolation, authorization, expiry, and no-notification journey passes. |
| Fresh-reader evidence path | `scripts/reader-evidence.test.ts` and the repository links it checks | Every listed reader criterion is checked from a fresh-clone perspective. |
| Fresh-contributor path | Contribution links plus the live unsigned external pull-request proof | Every contributor link resolves and an unsigned PR remains open and unmergeable. |
| Deterministic evidence integrity | `apps/agent/scripts/package-deterministic-evidence.mjs` output and `verifyDeterministicEvidenceBundle` | The clean summary, JUnit, JSON, JSONL, source SHA, and SHA-256 files agree. |
| Canonical origin and redirect | Read-only HTTPS requests to `https://tendnote.com` and the former origin | The canonical origin succeeds and the former origin returns a permanent redirect to the exact canonical origin. |
| Repository verification | `pnpm verify`, `pnpm db:check`, browser/Instant contracts, coverage, Fallow, and implicated lanes | Every applicable verification lane passes on the same candidate. |

The fresh-reader criteria intentionally name licenses, attribution,
navigation, immutable links, bounded claims, security, contribution,
self-hosting, support, and absence of maintainer-specific current-tree
configuration. The fresh-contributor criteria intentionally name every public
link and the live unsigned-contributor refusal. Omitting one creates a blocked
report rather than silently shrinking the contract.

## Owner-only gates

The report must preserve these as pending until the corresponding human action
and read-only verification actually occur:

- repository visibility remains unchanged until #489 is separately approved;
- CLA Assistant's live external-contributor proof is tracked by #516 after the
  repository is public;
- fork pull-request approval is tracked by #494 after the repository is public;
- GitHub Private Vulnerability Reporting must be enabled and then verified
  unauthenticated before final qualification.

No report input authorizes changing repository visibility, rulesets, hosted
settings, CLA records, or external sends. The candidate commit and report may
be prepared while those gates are pending; they cannot be called qualified
until every required result is observed and evidence is tied to that exact
commit.
