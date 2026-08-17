# Owner Data Export Is Owner-Scoped And Portable

Phase 9a must make Tendnote's promise that an owner can take their data with
them concrete, including a self-hoster moving to another deployment. The
export is therefore an explicitly requested, versioned archive of the owner's
durable record graph: their minimal account profile; People and contact
methods; Memories and Source Records; Interactions and Follow-Ups; General
Actions and Areas; Assets, Asset Memories, and Asset Evidence; Saved Items;
Context Facts; Message Drafts; Gift Plans and their contributions; related
links, lifecycle history, and ownership/share metadata needed to interpret
those records. It includes every lifecycle state and restricted-sensitivity
content. Asset Evidence bytes ship beside their metadata.

The archive is a ZIP with a machine-readable JSON manifest and versioned JSON
resources, plus a concise human-readable inventory. Import is deliberately
outside Phase 9a, but stable ids, relationships, and declared export schema
make a future importer possible. A request creates an owner-scoped background
job; Account exposes its status and a short-lived authenticated download when
it completes. It sends no email or other external notification, and the
generated archive expires after 24 hours.

An owner export does not transfer someone else's data or a Household
Workspace's data. It excludes records merely shared *to* the requester;
Household-native records, Household rosters, and other members' content;
credentials, sessions, OAuth tokens, provider-connection state, Calendar
caches, generated snapshots and embeddings, queues and job deliveries, and
internal audit rows. The manifest names those exclusions and tells an operator
to reconnect providers. A future Household Workspace export is a separately
authorized portability problem, not an implicit side effect of a member
export.

## Consequences

Restricted data must receive clear sensitivity labelling inside the archive;
deliberate export is not a proactive surface. The generated archive is itself
sensitive content and never becomes a durable product record, an email
attachment, or an external draft. Export coverage follows canonical records,
not caches or operational tables, so export and eventual import do not turn
derived state into truth.
