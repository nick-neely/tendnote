# Shared Owner-Scoped Mutations

Phase 1 write behavior must go through shared owner-scoped service/query functions before either the web app or Eve agent can mutate Tendnote data. Those shared functions should validate inputs with `@tendnote/domain`, write through `@tendnote/db`, enforce owner scoping and approval boundaries, and create audit log entries so routes and agent tools do not grow separate versions of the same product rules.
