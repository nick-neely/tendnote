# Message Drafter Proposes Before Persisting

Phase 3's message drafter subagent may proactively suggest that a message would be useful and may show ephemeral draft proposals, but it must create a persisted Tendnote message draft only after explicit owner intent such as "draft it," "save this draft," or accepting a draft proposal. Gmail externalization remains behind the existing approval gate, and scheduled workflows must not silently fill the draft list with speculative drafts.
