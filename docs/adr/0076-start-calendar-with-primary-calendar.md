# Start Calendar With Primary Calendar

Phase 2C should default Google Calendar reads to the owner's primary calendar rather than building multi-calendar selection in the first slice. The provider and cache seams should still carry `calendarId` from day one so secondary calendars, calendar-list reads, and selection UI can be added without rewriting event cache keys, Eve tool inputs, or scheduled workflow integrations. This keeps the initial Calendar integration focused while avoiding a hidden primary-calendar-only assumption in shared product APIs.
