# Reserve Shared Scopes But Block Writes

Phase 1A may keep `private`, `shared`, and `household` as scope enum values, but normal product flows should default to `private` and block non-private writes until shared household privacy boundaries exist in code. Shared and household scope should not be exposed as selectable UI in Phase 1A.

This preserves future migration room without implying that shared context is safe before permissions, query enforcement, and privacy evals are implemented.
