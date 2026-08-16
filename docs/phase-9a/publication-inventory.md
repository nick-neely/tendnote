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

**The finding that matters most, and the reason #449 was blocked on this one.**

Commit `994f64f` (2026-06-27, three days into the project) replaced `Juli` with
`Mara` across fixtures, tests, `apps/web/PRODUCT.md`, and `docs/prd.md`. The
current tree contains **zero** occurrences. History contains **7 commits across
12 files**.

A rename does not remove a name from history. If the history ships,
`git log -S Juli` recovers it in one command.

The commit message calls it a persona change. The pattern is nonetheless
consistent with an early real first name later pseudonymised: a real-sounding
given name, replaced very early, across both fixtures and the persona
documentation.

**This requires the author to state whether `Juli` is a real person.** The
answer changes #449 materially:

- Not a real person: history is clean on this axis and can ship as-is.
- A real person: shipping history publishes an identifiable first name attached
  to relationship-app fixtures, permanently. Options narrow to targeted history
  rewriting before publication, or a fresh initial commit.

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

Three `dpl_*` identifiers appear in `docs/verification/`:

- `dpl_Ck8imQpQWV9yRgHpu6D5PJbPi1qu` in `nextjs-16-3-partial-prefetching.md`
- `dpl_EPFJFXRhbc7dFxqGXfuhHRCJ7Tnx` in `nextjs-16-3-preview-qualification.md`
  (six occurrences, including a `vercel promote ... --scope nick-neely` command)
- `dpl_HPRTstVhvEA2td8ryQKenPXAzqkn`

Deployment ids are not credentials. They tie the repository to a specific
Vercel account and are meaningless to a public reader. One is documented as
retained deliberately for a promotion window, so deletion is not automatic.

Low severity. Execution detail for the publication slice, not a decision.

### 4. `stacklet.app` hardcoded in source and configuration

Nine tracked files reference the current deployment host, including source
rather than only configuration: `apps/web/src/lib/email/transactional.ts`,
`packages/domain/src/household-governance.ts`, `apps/web/.env.example`, and
`docs/email-setup.md`.

Not sensitive. Two reasons it still matters:

- A repository promising self-hosting (ADR 0225) with the maintainer's hosted
  domain compiled into source is a poor first impression and a likely source of
  self-hoster confusion. **This is a fact for [#454](https://github.com/nick-neely/tendnote/issues/454)**, which decides self-hosted
  admission and deployment configuration.
- It changes when `tendnote.com` lands ([#456](https://github.com/nick-neely/tendnote/issues/456)).

### 5. Author email in commit metadata

`neelynickolas@gmail.com` appears in the author field of all 723 commits. This
is normal, unavoidable, and expected for an open source project. Recorded for
completeness; it is not a blocker and needs no action.

## What this unblocks

[#449](https://github.com/nick-neely/tendnote/issues/449) is now actionable. The history question reduces to a single open
input: whether `Juli` is a real person. Every other axis of the history is
clean, which is a materially better starting position than the ticket assumed.
