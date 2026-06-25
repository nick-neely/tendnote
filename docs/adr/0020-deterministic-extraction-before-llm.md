# Deterministic Extraction Before LLM

Phase 1A should prove source-record and memory lifecycle plumbing before adding LLM extraction. The first extraction processor can be deterministic or manually triggered, ensuring that source records create jobs, jobs create reviewable suggested memories, users can save, edit, or dismiss those suggestions, and audit logs record each transition.

LLM-based extraction should be added after the review UI, lifecycle rules, and eval coverage exist. This avoids debugging database lifecycle, user experience, and model extraction quality at the same time.
