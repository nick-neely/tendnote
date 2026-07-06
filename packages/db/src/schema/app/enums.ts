import { pgEnum } from "drizzle-orm/pg-core";

export const accessStatus = pgEnum("access_status", ["pending", "granted", "denied"]);

export const accessSource = pgEnum("access_source", ["bootstrap", "manual_grant", "beta_flag"]);

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

export const confidence = pgEnum("confidence", ["low", "medium", "high"]);

export const privacyScope = pgEnum("privacy_scope", ["private", "shared", "household"]);

export const householdRole = pgEnum("household_role", ["owner", "member"]);

export const householdMemberStatus = pgEnum("household_member_status", [
  "invited",
  "active",
  "removed",
]);

export const visibilityRecordKind = pgEnum("visibility_record_kind", [
  "memory",
  "source_record",
  "followup",
]);

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
]);

export const generalActionEventKind = pgEnum("general_action_event_kind", [
  "created",
  "edited",
  "completed",
  "reopened",
  "deferred",
  "dismissed",
  "archived",
]);

export const extractionJobStatus = pgEnum("extraction_job_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);

export const semanticRecordKind = pgEnum("semantic_record_kind", ["memory", "source_record"]);

export const semanticTrustLevel = pgEnum("semantic_trust_level", [
  "confirmed_fact",
  "logged_context",
]);

export const embeddingJobStatus = pgEnum("embedding_job_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);

export const backgroundJobKind = pgEnum("background_job_kind", ["extraction", "embedding"]);

export const backgroundJobDeliveryStatus = pgEnum("background_job_delivery_status", [
  "pending",
  "published",
  "publish_failed",
  "abandoned",
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
]);
