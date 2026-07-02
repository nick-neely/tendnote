# Google Contacts Import Uses Fixtures and Manual Smoke Testing

Phase 2E should verify Google Contacts import with fake adapters and fixture-based tests in CI, plus a manual live-Google smoke checklist for connection, preview fetch, safe confirmation, conflict handling, and disconnect behavior. Live Google API tests should not run in normal CI because provider accounts, scopes, and network behavior would make the suite flaky and hard to reproduce.
