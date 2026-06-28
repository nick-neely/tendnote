# Brief Schedules Use an App-Owned Dispatcher

Phase 1F should use Eve root-level schedules only as static dispatchers and keep per-user daily and weekly brief timing in Tendnote-owned application rows with timezone, next-run, lease, retry, and idempotency state. Eve schedules are root-only static files, Vercel evaluates cron in UTC, and delivery is at least once, so user-local brief timing and duplicate protection belong in Tendnote's database rather than in generated cron files.

This follows Eve's dynamic scheduling pattern: one authored `agent/schedules/` dispatcher wakes on a cadence, atomically claims due work, and calls the shared owner-scoped brief generator directly. The dispatcher should not start an Eve chat session with `receive(...)` for normal in-app brief persistence; proactive channel delivery can be added later when an external or conversational notification surface exists.

The web app may expose a narrow manual generate/regenerate action for local testing and recovery, but it should call the same shared generator as the dispatcher. Regeneration should be explicit and auditable rather than a normal render-time refresh.
