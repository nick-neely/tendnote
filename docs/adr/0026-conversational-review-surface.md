# Conversational Review Surface

Phase 1 review should be person-centered with a lightweight review queue entry point, but the product should not feel like task management. The main interaction model should be an assistant surface where Tendnote can respond conversationally and render structured components for source records, suggested memories, suggested follow-ups, briefs, and drafts when an action needs review.

The review queue helps users find unresolved items; the actual review experience should happen in context through person profiles and assistant-generated components. This keeps Tendnote closer to a relationship memory assistant than an inbox or CRM task board.

## Update (2026-06-26)

The assistant-rendered `suggested_memory_review` component is now interactive, not just explanatory. When Eve surfaces a tentative suggestion in chat, the card carries inline Approve / Dismiss controls that call the same owner-scoped review mutations the person ledger and dashboard use, and then resolve in place (Saved to memory / Dismissed). The user can still tell Eve to approve or dismiss in words — the buttons just remove the round trip. This keeps review "in context" as the ADR intended while removing surface area: the same action is reachable from the person profile, the dashboard rail ([0025](0025-review-loop-before-dashboard.md)), and the chat card.

Two guardrails hold. Eve still never approves or dismisses on the user's behalf — the buttons are the user's own action, and the agent only mutates on an explicit instruction. And the conversation is not the source of truth: the card references the persisted memory id ([0028](0028-assistant-components-reference-records.md)) and the mutation reloads the authoritative record before acting. Eve presents suggestions by the person's name and the record's content; raw ids are never shown to the user.

Rendering the cards must not depend on the model choosing to make an extra tool call. The "what do I have to review?" intent is served by a single plural tool, `list_suggested_memory_reviews` (optionally person-scoped), whose one result renders an interactive review card per open suggestion. The singular `get_suggested_memory_review` is reserved for pulling up one specific suggestion in detail. This matters because the agent runs a small model (Haiku) that, given a person-context summary, will otherwise answer in prose and skip the per-item loads — so the tool surface, not the prompt alone, is what guarantees the actionable widget appears.
