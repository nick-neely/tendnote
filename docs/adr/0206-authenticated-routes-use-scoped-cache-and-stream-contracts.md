# Authenticated Routes Use Scoped Cache and Stream Contracts

After request-bound Better Auth and Private Beta Access admit the caller, Tendnote keeps every normal product route instant-capable. The admitted frame and a truthful route fallback render immediately; stable owner- or viewer-scoped read models may use `"use cache"`, while volatile compositions and externally authoritative reads stream behind useful Suspense boundaries. `instant = false` is reserved for the `/reminders/open` visibility-dependent redirect and the authentication, password-recovery, and pending-access boundaries outside the admitted product experience.

## Route and region contract

| Surface | First useful render | Deferred regions |
| --- | --- | --- |
| Today `/` | Stream the Today-specific context and shortlist inside the admitted frame. | Briefs, Calendar nudges, and Eve resolve independently. Do not load the full Review composition. |
| Review `/?tab=review` | Stream the selected Review view and a lightweight navigation count. | Review families keep independent fail-soft boundaries. Do not load the full Today or Eve composition. |
| People | Cache the bounded default list. | None unless optional metadata is introduced. |
| Person detail | Cache the visible core profile and lightweight pane counts; load the default pane first. | Load inactive panes on first activation. Stream snapshots, Gmail capability, proposals, drafts, reminders, and other optional enrichment independently. |
| Action Today | Cache the bounded active projection with its linked-Asset labels. | None beyond row-level interaction reconciliation. |
| Actions | Cache active Actions and Areas first. | Load paused, resolved, suggested-review, reminder, and linking data when their panes or controls become relevant. |
| Assets | Cache the default first page. | Stream arbitrary search, filtering, and pagination as owner-gated reads rather than creating high-cardinality cache entries. |
| Asset detail | Cache the visible core Asset and lightweight section counts; load the default overview first. | Load inactive panes on first activation. Stream memories, evidence, Actions, links, history, review state, snapshots, and other independently filtered enrichment in useful regions. |
| Saved Items | Cache active items first. | Load archived items and reminder-management data when opened. |
| Account and Contact Import | Stream provider connections, live Calendar state, reminder installations, environment capability, and provider-backed previews. | Isolate each external or fail-soft provider region. |
| Global Search, Global Capture, and Eve | Keep query, capture, and conversation state out of shared route caches. | Their owner-gated reads or mutations run only after explicit interaction and reconcile through shared product contracts. |
| Reminder deep link | Block while authoritative visibility resolution chooses a redirect or the generic unavailable state. | None. |

Person and Asset detail always use the same neutral fallback and eventual not-found result for missing and unauthorized records. A visible parent never makes its independently scoped children cacheable as one aggregate.

## Cache identity and lifetime

Cache only bounded serialized view models behind small framework-neutral owner-scoped product queries. Next.js-specific wrappers centralize cache keys and tags. Keys carry every visibility dimension used by the query: verified owner or caller identity, domain, record identifiers, filters, and pagination arguments. Better Auth sessions, admission decisions, raw request values, provider credentials, and client-supplied identity never enter a shared cache.

Two explicit profiles bound ordinary staleness:

| Profile | Stale | Revalidate | Expire | Use |
| --- | ---: | ---: | ---: | --- |
| `interactive` | 30 seconds | 30 seconds | 5 minutes | Frequently changed People, Actions, Assets, Saved Items, detail projections, and counts. |
| `reference` | 5 minutes | 15 minutes | 24 hours | Areas, household-member choices, and similarly low-churn reference projections. |

Elapsed time is a recovery bound, not the primary consistency mechanism. Tags use centralized scope builders for owner-private collections, viewer-visible collections, and viewer-visible entities. Access, membership, or visibility changes invalidate every affected viewer scope.

## Reconciliation and fallbacks

Shared mutations return typed affected scopes rather than route names or handwritten cache tags. User-originated Server Actions translate those scopes to `updateTag` so the initiating owner reads their own write. Background jobs, webhooks, and provider callbacks translate them to `revalidateTag(tag, "max")` so successful cached content may remain briefly visible while it refreshes. Existing `revalidatePath` calls remain only as a migration safety net until tag-coverage tests prove they are redundant.

Suspense boundaries align with independently useful regions, not individual rows and not the whole page. Fallbacks preserve final geometry, name the real region without fabricating owner data, and distinguish loading, empty, unavailable, and error states. Optional Calendar, Gmail, snapshot, review, history, and provider work fails soft without erasing successful core content. Once a region has rendered, revalidation preserves it with local pending feedback instead of replacing it with a skeleton.
