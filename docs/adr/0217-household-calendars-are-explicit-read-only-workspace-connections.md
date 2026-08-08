# Household Calendars Are Explicit Read-Only Workspace Connections

Phase Eight may expose a Google Calendar to an entire Household Workspace only
after a Household Owner explicitly designates that calendar as a Household
Calendar Connection and confirms that its events are appropriate for every
current and future active Household Member. The credential-holding Google
account is only a technical connector: it grants no creator or content
authority, and members do not need their own Google connection to read the
designated calendar in Tendnote. Personal Calendar connections remain
owner-scoped and are never implicitly combined with the Household view.

Google Calendar remains the event source of truth. Tendnote reads minimized,
bounded event summaries and may cache them briefly under the existing freshness
rules, but it never creates, edits, deletes, synchronizes, RSVPs to, or schedules
against provider events. An explicit Household Event Plan may reference a shared
Calendar event while retaining only Tendnote-native planning content. This is a
hard privacy and product boundary: it makes a deliberately shared calendar
useful to the household without turning Tendnote into a calendar client or
allowing a member's private Calendar data to leak through a workspace feature.
