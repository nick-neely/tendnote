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
has read roughly 30 percent of the code, the evaluation is the suite's first
Phase 9a execution rather than an established continuous record, and Household
collaboration has not yet been exercised with a second person. A clean eval
run is evidence for the evaluated behavior, not a blanket correctness claim.

Phase 9a may also publish a reader-friendly Publication Companion for launch.
It presents the same bounded claims, links back to the canonical Case Study,
the exact repository commit, and the evaluation evidence, and makes no claims
the canonical document does not make. It has no hosted-product call to action,
pricing, signup path, or other commercialization framing. Choosing its venue
and launch sequence is a separate publication-distribution decision; building
a marketing site remains Phase 9b work.

## Consequences

The repository remains the durable and citable source of truth even if launch
material is presented elsewhere. The companion must be derived from, and kept
consistent with, the canonical document rather than becoming a second decision
record.

Publication cannot treat an attractive presentation as a substitute for proof:
the Case Study cannot be final until the evaluation gate has a preserved result
to cite. Later reader-navigation work must make the README's doorway and the
Case Study easy to find without re-opening this claim or moving commercialization
into Phase 9a.
