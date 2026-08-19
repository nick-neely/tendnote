# Publication inventory: what cannot be published

Resolves [Inventory what cannot be published](https://github.com/nick-neely/tendnote/issues/448).

ADR 0224 withholds exactly three classes: secrets and credentials, personal
data in seed or development fixtures, and private beta admission configuration.
Everything else publishes. This is the fact base for applying that rule, not a
decision about it.

Audited at commit `25b4f39` on `docs/phase-9a-wayfinder`.

## Method

- **Secrets**: `gitleaks 8.30.0` over the full object graph (`gitleaks git .`),
  covering **723 commits and 4.83 GB**. Because gitleaks scans diffs, this
  covers every state any tracked file has ever held, not just current content.
- **Personal data**: pattern sweeps over tracked content for email addresses,
  phone numbers, street addresses, and person names, plus targeted review of
  seed files, fixtures, and prose.
- **Infrastructure**: sweeps for deployment, project, and account identifiers.
- **History**: pickaxe searches (`git log -S`) for names removed from the
  current tree.

## Clean, no action required

| Class | Result |
| --- | --- |
| Secrets and credentials | **Zero findings** across 723 commits. Nothing to scrub. |
| `.env` files | Only `.env.example` tracked, in three locations. All are empty or key-names-only (`AI_GATEWAY_API_KEY=`). |
| Eve runtime snapshots | `.eve` is gitignored in full. **Zero tracked files**, despite `apps/agent/.eve/dev-runtime/snapshots/` containing full source snapshots on disk. |
| Email addresses | All synthetic: `@example.com`, `@tendnote.test`, `@tendnote.local`, plus generic placeholders (`owner@gmail.com`, `linked@gmail.com`). No real address in tracked content. |
| Phone numbers | All in the reserved `555` fictional range. Apparent outliers were SVG path data. |
| Street addresses | All synthetic (`123 Main St`, `1400 Maple Street`, `1600 Pennsylvania Avenue`). |
| Seed data | `packages/db/src/seed.ts` contains `Demo User` and `Riley Chen`. Synthetic. |
| Neon project context | No project identifiers in tracked content. #427 held. |
| CI secrets | Referenced by name only (`secrets.AI_GATEWAY_API_KEY`, `secrets.PRODUCTION_DATABASE_DIRECT_URL`). Correct practice. |
| `fallow-baselines/` | Pure code metrics keyed by file path. No personal data. |
| Tracked binaries | 9 files, all Tendnote brand icons. No screenshots, evidence uploads, or PDFs. |

## Findings

### 1. `Juli` survives in history and nowhere else

**Resolved: real person, consent given, ships as-is.** Retained here because it
is the audit record and because the surrounding facts still constrain #449.

Commit `994f64f` (2026-06-27, three days into the project) replaced `Juli` with
`Mara` across fixtures, tests, `apps/web/PRODUCT.md`, and `docs/prd.md`. The
current tree contains **zero** occurrences. History contains **26 distinct
lines across 7 commits**.

A rename does not remove a name from history. If the history ships,
`git log -S Juli` recovers it in one command.

**What is exposed.** First name only; no surname appears anywhere in history.
The name is explicitly bound to the author (`shared household (Nick + Juli)`,
`Support Nick and Juli shared context`) and carries relationship details in
fixtures: a relationship start date, a household detail, and a preference. All
mundane by any normal measure. Nothing touching health, finances, address, or
employer.

**Disposition.** Confirmed as the author's partner, a real person. She was
asked directly and raised no objection to the history being published. The
history therefore ships unmodified on this axis, which is also the outcome that
preserves the most value: no SHA rewrite, no broken references, and the
agent-driven build history stays intact as case-study evidence.

**A constraint discovered while investigating, which outlives this finding.**
The earliest commit containing the name is `d3bb16b`, the repository's *first
commit*. Any `git filter-repo --replace-text` pass over history therefore
rewrites **every SHA in the repository**. That would break commit references
across all existing issues and pull requests and the pinned commits in
`docs/verification/`. Should a future finding ever require history rewriting,
this cost applies to it too, and it makes a fresh initial commit relatively more
attractive than it first appears.

**#449 is unblocked but not decided.** Its remaining inputs are the SHA-rewrite
cost above, the deployment identifiers in finding 3, and whether history as
build evidence is actually wanted by the case study, which is [#451](https://github.com/nick-neely/tendnote/issues/451).

### 2. Vendored third-party skill ships without its license text

`.claude/skills/impeccable/` and `.agents/skills/impeccable/` are tracked, 250
files between them. The two copies **differ**, so they are variants rather than
a duplicate.

`SKILL.md` frontmatter declares `license: Apache 2.0`. Apache 2.0 is one-way
compatible with AGPL-3.0, so redistribution inside an AGPL work is permitted.
But **no license text is vendored alongside it**, and Apache 2.0 section 4(a)
requires giving recipients a copy of the License. Publishing as-is is a
compliance gap, small and entirely fixable.

Not a privacy finding. Raised as a licensing decision: vendor the license text
and a NOTICE, or exclude the skill directories from the published tree.

### 3. Vercel deployment identifiers and account scope in verification docs

> **Historical qualification evidence.** The identifiers and account scope
> below document the runs that produced the original records. They are immutable
> evidence, not current Tendnote configuration or a supported deployment target.

Three `dpl_*` identifiers appear in `docs/verification/`:

- `dpl_Ck8imQpQWV9yRgHpu6D5PJbPi1qu` in `nextjs-16-3-partial-prefetching.md`
- `dpl_EPFJFXRhbc7dFxqGXfuhHRCJ7Tnx` in `nextjs-16-3-preview-qualification.md`
  (six occurrences, including a `vercel promote ... --scope nick-neely` command)
- `dpl_HPRTstVhvEA2td8ryQKenPXAzqkn`

Deployment ids are not credentials. They tie the repository to a specific
Vercel account and are meaningless to a public reader. One is documented as
retained deliberately for a promotion window, so deletion is not automatic.

Low severity. Execution detail for the publication slice, not a decision.

### 4. Former hosted origin in source and configuration

The pre-publication tree contained the maintainer's hosted origin in nine
tracked files, including source rather than only configuration. Ticket #470
replaces those current-tree values with reserved synthetic examples and makes
operational URLs derive from the configured canonical `BETTER_AUTH_URL`.

This was not sensitive credential material, and the original value remains
recoverable from immutable history under ADR 0229. It is intentionally not
repeated here because this inventory is part of the current reader-facing tree;
the historical qualification records that retain deployment IDs are labeled as
historical evidence and are not configuration.

### 5. Author email in commit metadata

`neelynickolas@gmail.com` appears in the author field of all 723 commits. This
is normal, unavoidable, and expected for an open source project. Recorded for
completeness; it is not a blocker and needs no action.

## What this unblocks

[#449](https://github.com/nick-neely/tendnote/issues/449) is actionable and starts from a stronger position than the ticket
assumed. Secrets are clean across the entire object graph, the one personal-data
finding is consented, and the remaining inputs are known: the full-repository
SHA-rewrite cost recorded in finding 1, the deployment identifiers in finding 3,
and whether history-as-evidence is wanted by the case study ([#451](https://github.com/nick-neely/tendnote/issues/451)).

Nothing found in this audit requires history to be rewritten.
