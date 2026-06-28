import { pgEnum } from "drizzle-orm/pg-core";

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

export const briefItemKind = pgEnum("brief_item_kind", [
  "due_followup",
  "birthday",
  "review_item",
  "recent_context",
  "semantic_context",
  "suggested_followup",
]);

export const briefItemTrustLevel = pgEnum("brief_item_trust_level", [
  "active_reminder",
  "stored_profile_data",
  "logged_context",
  "confirmed_fact",
  "tentative",
]);
