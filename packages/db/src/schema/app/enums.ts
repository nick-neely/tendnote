import { pgEnum } from "drizzle-orm/pg-core";

export const accessStatus = pgEnum("access_status", ["pending", "granted", "denied"]);

export const accessSource = pgEnum("access_source", ["bootstrap", "manual_grant", "beta_flag"]);

export const selfContextOnboardingStatus = pgEnum("self_context_onboarding_status", [
  "not_started",
  "dismissed",
  "completed",
]);

export const relationshipType = pgEnum("relationship_type", [
  "friend",
  "family",
  "partner",
  "colleague",
  "professional",
  "networking",
  "neighbor",
  "other",
]);

export const contactMethodType = pgEnum("contact_method_type", [
  "email",
  "phone",
  "social",
  "other",
]);

export const sourceType = pgEnum("source_type", [
  "manual",
  "agent",
  "contact_import",
  "calendar",
  "gmail",
  "seed",
]);

export const memoryType = pgEnum("memory_type", [
  "preference",
  "life_event",
  "gift_idea",
  "boundary",
  "context",
  "other",
]);

export const sensitivity = pgEnum("sensitivity", ["normal", "sensitive", "restricted"]);

export const contextFactSubject = pgEnum("context_fact_subject", ["self", "household"]);

export const contextFactCategory = pgEnum("context_fact_category", [
  "background",
  "work",
  "location",
  "interest",
  "preference",
  "constraint",
  "composition",
  "other",
]);

export const contextFactLifecycle = pgEnum("context_fact_lifecycle", [
  "suggested",
  "active",
  "archived",
]);

export const confidence = pgEnum("confidence", ["low", "medium", "high"]);

export const privacyScope = pgEnum("privacy_scope", ["private", "shared", "household"]);

export const householdRole = pgEnum("household_role", ["owner", "member"]);

export const householdMemberStatus = pgEnum("household_member_status", [
  "invited",
  "active",
  "removed",
]);

// Whether a Household Workspace still exists for its members. `dissolved` is the
// unanimous active-Owner ending (ADR 0213): the row outlives the household so its
// household-native records can sit in the recovery window before permanent
// deletion, and so the ending itself stays auditable.
export const householdStatus = pgEnum("household_status", ["active", "dissolved"]);

// A Household Invitation's whole lifecycle (ADR 0213): one live state, four
// terminal ones. `expired` is written when a path observes the lapsed window;
// every read derives it from `expires_at` so a link is never usable past it.
export const householdInvitationState = pgEnum("household_invitation_state", [
  "pending",
  "accepted",
  "declined",
  "canceled",
  "expired",
]);

// The life of one durable send attempt. Deliberately only the states Tendnote
// itself produces: provider-reported outcomes (delivered, bounced, complained,
// suppressed) arrive through a webhook consumer that does not exist yet, and an
// enum value with no producer would read as supported behavior.
export const householdInvitationDeliveryStatus = pgEnum("household_invitation_delivery_status", [
  "queued",
  "sending",
  "sent",
  "failed",
]);

export const visibilityRecordKind = pgEnum("visibility_record_kind", [
  "memory",
  "source_record",
  "followup",
  "general_action",
  "saved_item",
  // Phase 6 Asset Memory: Assets ride the same share rails as other scoped records (#197).
  "asset",
  // Asset Memories are independently scoped child records under an Asset (#198).
  "asset_memory",
  // Asset Evidence is independently scoped under an Asset, like memories (#200).
  "asset_evidence",
]);

// Phase 6 Asset Memory (#196/#197): the small fixed Asset Kind set — practical
// owner-/household-scoped resources only, never a taxonomy the user manages.
export const assetKind = pgEnum("asset_kind", [
  "item",
  "appliance",
  "vehicle",
  "subscription",
  "service",
  "property",
]);

// Archive is the normal inactive path; hard delete is reserved for the
// correction/privacy escape hatch (#207). `suggested`/`dismissed` are
// the review-gated proposal states (#198) — never durable records; every
// scope-visible read filters to active/archived.
export const assetStatus = pgEnum("asset_status", ["active", "archived", "suggested", "dismissed"]);

export const assetAuditEventKind = pgEnum("asset_audit_event_kind", [
  "created",
  "edited",
  "archived",
  "restored",
  // Review-gated trail (#198): proposal life, duplicate-review resolution, and
  // asset-keyed Asset Memory writes (memory id rides in detail JSON).
  "suggested",
  "promoted",
  "dismissed",
  "linked_existing",
  "memory_created",
  "memory_suggested",
  "memory_edited",
  "memory_promoted",
  "memory_dismissed",
  // Evidence capture trail (#200): the evidence id rides in detail JSON.
  "evidence_added",
  "evidence_removed",
  // Related Asset Link and Asset Person Link trails (#202): the link id and the
  // other record's id ride in detail JSON.
  "link_added",
  "link_suggested",
  "link_promoted",
  "link_dismissed",
  "link_removed",
  "person_link_added",
  "person_link_removed",
  // A Suggested General Action proposed from a reviewed Asset Memory (#203). The
  // action id, the memory id, and the proposal reason ride in detail JSON. Only the
  // *proposal* is audited here — the action's own lifecycle stays authoritative on
  // the action side, so Asset History never forks into a second maintenance log.
  "action_proposed",
]);

// The fixed Related Asset Link relation set (#202): subject-first ("the filter
// *fits* the refrigerator"). Fixed like Asset Kinds — never a user taxonomy.
export const assetLinkRelation = pgEnum("asset_link_relation", [
  "fits",
  "uses",
  "part_of",
  "replaces",
  "covers",
  "stored_with",
]);

// Related Asset Link lifecycle (#202), mirroring asset_memory_status: suggested
// (review-gated) → active on accept or explicit create; dismissed is the husk.
export const assetLinkStatus = pgEnum("asset_link_status", ["suggested", "active", "dismissed"]);

// The fixed Asset Person Link relation set (#202): contextual only — a person
// link never confers ownership or visibility.
export const assetPersonRelation = pgEnum("asset_person_relation", [
  "recommended",
  "borrowed",
  "uses",
  "stores",
  "services",
  "knows_about",
]);

// Asset Memory lifecycle (#198): suggested (review-gated) → active on accept;
// dismissed is the resolved husk of a rejected suggestion.
export const assetMemoryStatus = pgEnum("asset_memory_status", [
  "suggested",
  "active",
  "dismissed",
]);

// The small fixed Asset Evidence kind set (#200): what a piece of evidence is,
// never a folder taxonomy — evidence grounds Assets, it is not a document library.
export const assetEvidenceKind = pgEnum("asset_evidence_kind", [
  "receipt",
  "photo",
  "manual",
  "warranty",
  "link",
  "note",
]);

// Where an Asset write originated. Coarse on purpose — provenance detail rides in
// the audit event's detail JSON.
export const assetAuditSource = pgEnum("asset_audit_source", ["user", "assistant", "system"]);

export const sourceRecordStatus = pgEnum("source_record_status", [
  "pending_resolution",
  "active",
  "dismissed",
  "archived",
]);

export const sourceRecordRetentionPolicy = pgEnum("source_record_retention_policy", [
  "retain",
  "summarize_then_delete",
  "delete_after_processing",
]);

export const sourceRecordPersonRole = pgEnum("source_record_person_role", ["primary", "mentioned"]);

export const unresolvedMentionStatus = pgEnum("unresolved_mention_status", [
  "unresolved",
  "resolved",
  "dismissed",
]);

export const memoryStatus = pgEnum("memory_status", [
  "suggested",
  "approved",
  "dismissed",
  "archived",
]);

export const interactionType = pgEnum("interaction_type", [
  "call",
  "text",
  "email",
  "meeting",
  "hangout",
  "note",
]);

export const followupStatus = pgEnum("followup_status", [
  "suggested",
  "open",
  "snoozed",
  "completed",
  "dismissed",
  "archived",
]);

export const generalActionStatus = pgEnum("general_action_status", [
  "open",
  "deferred",
  "completed",
  "dismissed",
  "archived",
  // A Routine set aside without retiring it — non-terminal, resumable (ADR 0148).
  "paused",
  // Review-gated states (ADRs 0144, 0151, 0152): a proposal awaiting review, and the
  // quiet set-aside for one the user neither accepts nor formally dismisses.
  "suggested",
  "ignored",
]);

export const generalActionEventKind = pgEnum("general_action_event_kind", [
  "created",
  "edited",
  "completed",
  "skipped",
  "reopened",
  "deferred",
  "dismissed",
  "archived",
  "paused",
  "resumed",
  // Review-gated history (ADRs 0151, 0152).
  "suggested",
  "promoted",
  "ignored",
]);

export const savedItemKind = pgEnum("saved_item_kind", ["note", "link", "open_question"]);

export const savedItemStatus = pgEnum("saved_item_status", ["active", "archived"]);

export const savedItemEventKind = pgEnum("saved_item_event_kind", [
  "created",
  "edited",
  "archived",
  "reopened",
  "resolved",
  "promoted",
  "visibility_changed",
  "mutation_rejected",
]);

export const savedItemDestinationKind = pgEnum("saved_item_destination_kind", ["general_action"]);

export const extractionJobStatus = pgEnum("extraction_job_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);

export const contextFactExtractionJobStatus = pgEnum("context_fact_extraction_job_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "dead_lettered",
]);

// The assistants an owner can carry Self Context over from. This is a closed set
// because each entry is a hand-checked chat URL and prefill behavior, not a
// user-managed provider list.
export const contextFactImportProvider = pgEnum("context_fact_import_provider", [
  "chatgpt",
  "claude",
  "gemini",
]);

// How Tendnote read one paste: `block` parsed the requested fenced format locally
// and no part of the paste reached a model; `extraction` fell back to one bounded
// model call over loose prose.
export const contextFactImportSource = pgEnum("context_fact_import_source", [
  "block",
  "extraction",
]);

export const semanticRecordKind = pgEnum("semantic_record_kind", [
  "memory",
  "source_record",
  // General Actions are embedded and semantically retrievable alongside relationship
  // context (ADR 0150; Phase 5 #184).
  "general_action",
  // Assets and their reviewed memories share the same embedding pipeline, but are
  // retrieved through the typed Asset Search contract, not relationship retrieval (#204).
  "asset",
  "asset_memory",
  "saved_item",
]);

export const semanticTrustLevel = pgEnum("semantic_trust_level", [
  "confirmed_fact",
  "logged_context",
  // A General Action is an owner-authored intention — its own trust register.
  "action_item",
  // An Asset is an anchor for a thing the user owns; an Asset Memory is a reviewed
  // fact about that thing. Distinct registers so retrieval never mislabels either (#204).
  "asset_anchor",
  "asset_fact",
  "saved_context",
]);

export const embeddingJobStatus = pgEnum("embedding_job_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);

export const backgroundJobKind = pgEnum("background_job_kind", [
  "extraction",
  "embedding",
  "action_extraction",
  "context_fact_extraction",
  "reminder_push",
]);

export const backgroundJobDeliveryStatus = pgEnum("background_job_delivery_status", [
  "pending",
  "published",
  "publish_failed",
  "abandoned",
]);

export const reminderScheduleKind = pgEnum("reminder_schedule_kind", ["exact", "relative"]);
export const reminderRecordKind = pgEnum("reminder_record_kind", [
  "general_action",
  "follow_up",
  "routine",
  "saved_item",
]);
export const reminderOccurrenceStatus = pgEnum("reminder_occurrence_status", [
  "pending_installation",
  "pending",
  "superseded",
]);
export const reminderOptInStatus = pgEnum("reminder_opt_in_status", [
  "offered",
  "postponed",
  "denied",
  "registered",
  "disabled",
]);
export const reminderInstallationStatus = pgEnum("reminder_installation_status", [
  "enabled",
  "disabled",
  "revoked",
]);
export const reminderPreviewMode = pgEnum("reminder_preview_mode", ["generic", "detailed"]);
export const reminderDeliveryJobStatus = pgEnum("reminder_delivery_job_status", [
  "pending",
  "running",
  "completed",
  "skipped",
  "failed",
]);
export const reminderDeliveryOutcome = pgEnum("reminder_delivery_outcome", [
  "accepted",
  "transient_failure",
  "terminal_endpoint",
  "suppressed_stale",
  "suppressed_revoked",
  "suppressed_ineligible",
]);

export const providerConnectionStatus = pgEnum("provider_connection_status", [
  "ready",
  "pending",
  "connected",
  "revoked",
  "error",
  "unavailable",
]);

export const messageDraftChannel = pgEnum("message_draft_channel", [
  "text",
  "email",
  "slack",
  "other",
]);

export const messageDraftPurpose = pgEnum("message_draft_purpose", [
  "birthday",
  "thank_you",
  "check_in",
  "networking",
  "other",
]);

export const messageDraftStatus = pgEnum("message_draft_status", [
  "draft",
  "approved",
  "dismissed",
  "sent_manually",
]);

export const gmailDraftActionKind = pgEnum("gmail_draft_action_kind", ["create", "update"]);

export const gmailDraftActionStatus = pgEnum("gmail_draft_action_status", ["succeeded", "failed"]);

export const gmailDraftRecipientSource = pgEnum("gmail_draft_recipient_source", [
  "contact_method",
  "manual_entry",
]);

export const briefCadence = pgEnum("brief_cadence", ["daily", "weekly"]);

export const briefGenerationReason = pgEnum("brief_generation_reason", [
  "scheduled",
  "manual",
  "regenerated",
]);

export const briefItemStatus = pgEnum("brief_item_status", [
  "active",
  "dismissed",
  "snoozed",
  "acted_on",
]);

export const calendarSuggestionStatus = pgEnum("calendar_suggestion_status", [
  "suggested",
  "accepted",
  "dismissed",
]);

export const briefItemKind = pgEnum("brief_item_kind", [
  "due_followup",
  "birthday",
  "review_item",
  "recent_context",
  "semantic_context",
  "suggested_followup",
  "calendar_event",
]);

export const briefItemTrustLevel = pgEnum("brief_item_trust_level", [
  "active_reminder",
  "stored_profile_data",
  "logged_context",
  "confirmed_fact",
  "tentative",
]);

export const phase3ScheduledWorkflow = pgEnum("phase3_scheduled_workflow", [
  "morning_agenda",
  "post_meeting_aftercare",
  "weekly_relationship_review",
  "birthday_gift_planning",
  // Phase 5 scoped action summary — rides the same per-workflow delivery rails (ADR 0158).
  "action_summary",
]);

export const proactiveDeliveryChannel = pgEnum("proactive_delivery_channel", ["discord"]);

export const discordTargetKind = pgEnum("discord_target_kind", ["channel", "dm"]);

export const proactiveDeliveryStatus = pgEnum("proactive_delivery_status", [
  "sent",
  "skipped",
  "failed",
]);

export const scheduledArtifactKind = pgEnum("scheduled_artifact_kind", [
  "morning_agenda",
  "post_meeting_aftercare",
  "weekly_relationship_review",
  "birthday_gift_planning",
  "brief",
  "action_summary",
]);

export const todayFeedbackKind = pgEnum("today_feedback_kind", ["later", "not_today"]);
