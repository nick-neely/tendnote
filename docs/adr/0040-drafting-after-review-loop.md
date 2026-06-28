# Drafting After Review Loop

Phase 1 should build message drafting after the source-record and memory review loop is working. Drafts should draw from approved memories as facts, source records as source-grounded context, and suggested memories only as tentative optional hints according to the context trust policy.

Phase 1G draft records should persist the source references that informed the draft, not rely on prompt-only grounding. Those references should identify which approved memories, source records, suggested memories, follow-ups, or brief items were used so the draft can be reviewed, explained, tested, and audited after generation. The draft body remains editable user-facing prose; persisted source references are the grounding contract.

This prevents unreviewed or messy extraction behavior from turning into overconfident message drafts.
