# Contribution agreements

## Status

The contribution agreement is a publication dependency and is **pending
counsel review and owner approval**. The proposed [contribution agreement
packet](legal/README.md) contains the [individual
ICLA](legal/individual-contributor-license-agreement.md), [employer
authorization](legal/employer-contribution-authorization.md), and [corporate
CLA](legal/corporate-contributor-license-agreement.md) drafts. Every draft is
marked pending counsel approval and is not effective until the owner updates
its status. This page is an implementation status and process note, not a
Contributor License Agreement, legal advice, or a document that grants any
rights. Do not sign or rely on a draft as an agreement.

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

After the exact approved agreement is available, the project will:

1. publish the approved individual agreement and documented employer or
   corporate authorization path;
2. configure CLA Assistant to use that exact artifact and retain signature
   evidence; and
3. require the resulting CLA status on the default branch.

An unsigned or declined external pull request remains open but cannot merge.
Corporate authorization satisfies the same gate; it is not an undocumented
bypass. The live configuration and disposable external-contributor proof are
owned by [#473](https://github.com/nick-neely/tendnote/issues/473). This
checkout intentionally does not claim that the hosted app or default-branch
ruleset is configured or live.

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
the unsettled design inputs. They do not replace the pending approved legal
artifact.
