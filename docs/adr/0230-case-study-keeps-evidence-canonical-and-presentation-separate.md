# Case Study Keeps Evidence Canonical And Presentation Separate

Phase 9a's case study makes a narrow, inspectable claim: an agent-built
personal system can carry privacy-sensitive design invariants whose evidence a
skeptical technical reader can examine. It is not a claim that speed proves
quality, that Tendnote is fully verified, or that the product has already been
validated by multi-person household use.

## Decision

The canonical Case Study will be a versioned repository document at
`docs/case-studies/tendnote-agent-built-privacy.md`. The root README is its
concise doorway, not a substitute for the long-form evidence. Its reader path
starts with a concrete privacy-invariant claim, then follows the decision
record, the pre-publication deterministic evaluation result, and the preserved
git history as supporting audit evidence. History substantiates the account; it
does not lead it.

The Case Study must state its material limits beside its evidence: the author
has read roughly 15 percent of the code, the evaluation is the suite's first
Phase 9a execution rather than an established continuous record, and Household
collaboration has not yet been exercised with a second person. A clean eval
run is evidence for the evaluated behavior, not a blanket correctness claim.
The current preserved Gemini run is non-clean (52 of 60 cases passed), so it
must remain labeled exploratory evidence rather than being described as a
qualification pass.

The repository Case Study is the publication source. No parallel launch
document is part of this decision; external presentation and commercialization
work are outside this slice.

## Consequences

The repository remains the durable and citable source of truth. The exact
evaluation summary, raw output, checksums, and decision records are reviewed
as one immutable content bundle. The [reviewed-content bundle commit](https://github.com/nick-neely/tendnote/commit/00b2edcb11be862f747a96851eb66b71dcaefd7f)
is an inspection anchor, not the exact qualified integration/publication
commit. That final SHA is deliberately not claimed by this decision: #488
owns the qualification report and must pin it only after every publication
gate passes. A pre-qualification SHA or moving branch URL is not evidence of
publication.

Publication cannot treat attractive presentation as a substitute for proof:
the Case Study must preserve and label the exact result it cites. Later
reader-navigation work must make the README's doorway and the Case Study easy
to find without opening a second planning or commercialization path.
