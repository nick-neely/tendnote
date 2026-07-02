# Google Contacts Import Has Policy First Verification

Phase 2E should add targeted policy tests for Google Contacts import proving that importing or confirming contacts cannot create Gmail drafts, send messages, bypass Gmail approval gates, or mutate external systems beyond the explicit Contacts read used for preview. Existing no-send and Gmail draft tests remain necessary but are not enough, because Contacts import introduces new provider data that later draft flows may use as confirmed recipient information.
