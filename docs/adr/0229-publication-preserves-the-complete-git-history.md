# Publication Preserves the Complete Git History

Tendnote publishes all 723 existing commits unchanged. The history is unusually
valuable evidence for the project's primary audience because it exposes the
agent-driven build as it happened; replacing it with a fresh initial commit
would discard that evidence and suggest that the development record was being
hidden.

The publication audit found no secrets and no unconsented personal data. Its
remaining historical residue, including Vercel deployment identifiers and an
account scope, is not credential material and does not justify rewriting every
commit SHA. Environment-specific values are removed or generalized in the
publication-ready tree, but their historical versions remain available.

After publication, the history is permanent. Mistakes are corrected with new
commits. Rewriting published history is reserved for a verified secret or a
legal or privacy obligation, not for stale metadata, untidiness, or
embarrassment.

## Consequences

Issue, pull-request, ADR, and verification references to existing commits stay
valid. The repository also permanently carries the benign operational residue
identified by the publication audit. If a qualifying exposure is discovered
later, removing it will require an exceptional incident response and cannot
guarantee recall from existing clones.
