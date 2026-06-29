# Product Rate Limits Are Separate From Auth Limits

Phase 2B should add a Tendnote-owned Redis-backed product rate limiter rather than stretching Better Auth's auth/session rate limiting across product workloads. Better Auth remains responsible for sign-in, signup, password reset, session, and auth-abuse limits, while the Tendnote limiter owns admitted product work such as Eve ingress, expensive server actions, queue consumers via `rateLimitKey` or `costCategory`, and future provider API calls.

The product limiter should reuse the existing Redis connection and expose deterministic fake-store seams for normal tests. It should fail conservatively for abusive or expensive entry points, but durable user mutations should still preserve committed product state where existing ADRs require queue/provider failures to be recoverable rather than destructive.
