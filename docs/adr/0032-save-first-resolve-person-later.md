# Save First Resolve Person Later

Phase 1A assistant capture should save a source record before forcing person disambiguation. When Tendnote can confidently match the person, it can create an active person-scoped source record; when the person is ambiguous or missing, it should create a pending source record and render a structured person-disambiguation component.

Pending source records should not feed extraction, profiles, briefs, or drafts until resolved, but saving them first protects quick capture from losing useful context.
