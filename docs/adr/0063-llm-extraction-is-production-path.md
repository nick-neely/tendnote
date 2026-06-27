# LLM Extraction Is The Production Path

Phase 1E.5 should route production suggested-memory extraction jobs through a replaceable LLM adapter rather than keeping deterministic extraction as an equally normal production path. The deterministic extractor remains useful for tests, local fixtures, and emergency fallback adapters, but production LLM failures should be visible through the existing `extraction_jobs` retry, failure, and audit lifecycle instead of silently creating lower-quality suggestions from retained content.
