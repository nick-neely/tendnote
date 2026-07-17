# Eve Auth Terminates In The Hosted Service

Vercel deploys the `withEve()` agent as a separate service and routes `/eve/v1/**`
to it before Next.js filesystem routing. Therefore a Next proxy cannot be the
security boundary for hosted Eve traffic, even though that proxy runs during some
local topologies.

The Eve channel must verify the browser's Better Auth session cookie directly,
require the persisted Private Beta Access decision, and charge the owner-scoped
Eve ingress budget before starting model work. Only Eve's loopback-only local
authenticator may map a request to the configurable development owner. Tools must
require the authenticated session principal and must never invent `demo-user`.

The web and Eve processes share the security-sensitive Better Auth baseline
(secret, base URL, trusted origin, secure-cookie, database, and Redis secondary
storage conventions) plus product rate-limit implementation through workspace
packages. Feature-specific OAuth providers and hooks remain owned by the web app.

This supersedes only the header-injection auth boundary described by ADR 0061;
same-origin client streaming and the separate Eve service topology remain in
force.
