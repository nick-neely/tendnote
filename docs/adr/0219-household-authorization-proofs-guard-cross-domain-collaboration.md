# Household Authorization Proofs Guard Cross-Domain Collaboration

Phase Eight will require every Household-capable domain operation to obtain a
current **Household Authorization Proof** from its domain-owned query or
mutation boundary. The proof evaluates the caller, active membership, requested
operation, ownership form, audience, lifecycle, sensitivity, and any
domain-specific exclusion such as a Gift Plan's Surprise Subject. A Household
Owner role, a visible UI control, an Eve instruction, a deep-link token, a
cached view, or a prior successful read is never enough on its own.

The same rule applies to derived and deferred work. Caches, read models, queued
jobs, reminder intents, provider caches, and deep links may retain only data
their current user could have obtained, must be invalidated on access-changing
events, and must obtain the proof again immediately before revealing, acting on,
or delivering anything. Uncertain or unauthorized access has one opaque outcome:
no content, count, explanation, or signal that a protected record exists.

This adds a small cross-domain policy seam instead of trusting each adapter to
reconstruct Household privacy. It is deliberately stronger than a generic role
check because Household visibility, ownership, sensitivity, and authority vary
by record family. The cost is explicit policy matrices and isolation testing for
each implementation slice; the benefit is that web, Eve, Capture, Review,
Search, Today, Household, background work, and provider integrations cannot
quietly drift into different disclosure behavior. The full audit, retention,
recovery, and implementation-evidence contract lives in
[`docs/phase-8/household-privacy-recovery-and-isolation.md`](../phase-8/household-privacy-recovery-and-isolation.md).
