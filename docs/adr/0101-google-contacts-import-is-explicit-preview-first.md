# Google Contacts Import Is Explicit Preview First

Phase 2E should use an explicit user-triggered "preview latest contacts" flow rather than background sync, webhook handling, polling, or automatic refresh. The import adapter and preview-session model should still leave room for a later sync system to reuse provider fetching, candidate matching, and conflict-resolution logic, but Phase 2E should not surprise the user with profile changes that happen outside an intentional preview-and-confirm moment.
