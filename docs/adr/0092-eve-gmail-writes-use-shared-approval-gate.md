# Eve Gmail Writes Use Shared Approval Gate

Phase 2D should let Eve participate in Gmail draft creation and update flows, including revising Tendnote drafts and presenting approval cards, but Eve-facing Gmail write tools must require the same explicit approval artifact or token used by the web UI. The assistant should not turn ambiguous natural-language requests directly into external Gmail mutations. This keeps chat as a first-class surface while ensuring Gmail writes go through one shared approval, idempotency, audit, and provider-connection boundary.
