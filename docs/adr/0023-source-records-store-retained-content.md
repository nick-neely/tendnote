# Source Records Store Retained Content

Phase 1 source records should distinguish retained content from raw input. `content` is the minimized text Tendnote keeps for retrieval, grounding, and review; `raw_content` should be optional and short-lived or development-only when needed; `retention_policy` should describe whether the record is retained, summarized then deleted, or deleted after processing.

Manual Phase 1 notes may store the user-entered note directly as retained content. Future provider data such as Gmail bodies, message logs, calendar payloads, or imports should not automatically become permanent retrieval substrate without minimization and retention rules.
