# Contribution agreements

## Status

The agreement packet is **counsel-reviewed and owner-approved; Version 1.0 is
effective 2026-08-21**. The [contribution agreement
packet](legal/README.md) contains the [individual
ICLA](legal/individual-contributor-license-agreement.md), [employer
authorization](legal/employer-contribution-authorization.md), and [corporate
CLA](legal/corporate-contributor-license-agreement.md) forms. This page is an
implementation status and process note, not a Contributor License Agreement,
legal advice, or a document that grants any rights. Use the exact forms for
acceptance or signature.

ADR 0233 records the intended shape: a counsel-reviewed, Apache ICLA-derived
individual agreement that grants the project the permissions needed to
distribute an accepted contribution without taking the contributor's
copyright, plus an employer-authorization or corporate-agreement path where
the contributor's employer owns the work. The research note is background
material, not the final agreement.

The private founder-to-Neely Solutions LLC copyright-rights assignment or
confirmation required before publication is **owner-confirmed as executed**.
This page does not expose or reproduce that private instrument, and it does
not claim that counsel has verified it. Git authorship is not evidence of that
rights chain; the private record remains owner-controlled.

## Intended external-contributor path

For external contributions, use the exact effective Version 1.0 form and the
route that matches ownership:

1. accept the individual agreement through CLA Assistant when the approved
   process is enabled;
2. use the employer authorization or corporate agreement for employer-owned
   work; and
3. retain the private acceptance or signature record and expose only the
   minimum public status needed for the merge check.

An unsigned or declined external pull request remains open but cannot merge
once the required status is live. Corporate authorization satisfies the same
gate; it is not an undocumented bypass. The repository-owned [CLA Assistant
desired-state manifest](../.github/cla-assistant-desired-state.json), [metadata](legal/cla-assistant-metadata.json),
[redacted proof schema](phase-9a/cla-gate-proof.schema.json), and [operator
runbook](phase-9a/cla-enforcement-runbook.md) are prepared. Hosted activation,
observation of the actual status context, live ruleset update, and disposable
external-contributor proof are still owner-gated work in [#473](https://github.com/nick-neely/tendnote/issues/473).
This checkout intentionally does not claim that the hosted app, CLA Assistant,
or default-branch ruleset is currently configured or enforcing the gate, and it
does not claim live proof.

## AI-assisted contributions

AI-assisted contributions are permitted under the same submission-rights and
third-party-material duties as any other contribution. Before submitting,
confirm that applicable tool terms permit submission under the project's
license and policy. If you know that included output contains pre-existing
third-party material, disclose its source, attribution, and applicable license
or restriction in the pull request.

The public provenance field is optional and limited to provider/model and the
tool's role. A `Generated-by:` commit trailer is also optional. The project
does not request prompts, raw model outputs, account information, or usage
data.

See [ADR 0233](adr/0233-contributions-use-an-individual-cla-and-pr-local-provenance.md)
and the [governance research](phase-9a/contribution-governance-research.md) for
the design inputs. They do not replace the effective Version 1.0 legal forms.
