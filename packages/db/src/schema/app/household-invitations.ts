import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "../auth";
import { timestamps } from "./common";
import {
  householdInvitationDeliveryStatus,
  householdInvitationState,
  householdRole,
} from "./enums";
import { householdWorkspaces } from "./households";

/**
 * An email-address-bound, expiring capability to join one Household Workspace.
 *
 * It is deliberately not an early `household_memberships` row (ADR 0213): the
 * recipient may have no Tendnote account at all, the address is the subject
 * rather than a user id, and a membership must only ever come into existence
 * inside a successful acceptance.
 */
export const householdInvitations = pgTable(
  "household_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => householdWorkspaces.id, { onDelete: "cascade" }),
    invitedByUserId: text("invited_by_user_id").references(() => user.id, { onDelete: "set null" }),
    role: householdRole("role").notNull().default("member"),
    /** The address exactly as the Owner typed it, shown back only to them. */
    email: text("email").notNull(),
    /** Trimmed and case-folded. Every match — send, accept, decline — uses this. */
    normalizedEmail: text("normalized_email").notNull(),
    /**
     * A digest of the emailed secret, never the reusable secret itself. A
     * database leak must not yield working invitation links.
     */
    secretDigest: text("secret_digest").notNull(),
    state: householdInvitationState("state").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** When an external send was last explicitly requested by the Owner. */
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    resendCount: integer("resend_count").notNull().default(0),
    /** Set only by a successful acceptance, alongside the membership it created. */
    acceptedByUserId: text("accepted_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** When the invitation reached its terminal state, whichever one it was. */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("household_invitations_secret_digest_idx").on(table.secretDigest),
    /**
     * At most one live invitation per address per household. Partial on purpose:
     * terminal rows stay as evidence, and a fresh invitation to an address that
     * previously declined or expired is the supported way back in (ADR 0213).
     */
    uniqueIndex("household_invitations_live_recipient_idx")
      .on(table.householdId, table.normalizedEmail)
      .where(sql`state = 'pending'`),
    index("household_invitations_household_state_idx").on(table.householdId, table.state),
    index("household_invitations_recipient_state_idx").on(table.normalizedEmail, table.state),
  ],
);

/**
 * One durable request to hand one invitation to an email provider.
 *
 * This row — not the provider — is the exact-once authority. It is created in the
 * same transaction as the invitation (or the resend that rotated it), claimed
 * before any external call, and only then completed with the provider's message
 * id or a failure class. An ambiguous network failure reuses this attempt id; an
 * explicit resend never does, because a resend is a different message with a
 * different secret.
 */
export const householdInvitationDeliveries = pgTable(
  "household_invitation_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => householdInvitations.id, { onDelete: "cascade" }),
    status: householdInvitationDeliveryStatus("status").notNull().default("queued"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** The provider's own id for the message, when one came back. */
    providerMessageId: text("provider_message_id"),
    /**
     * A coarse failure class, never a provider payload or message body. It exists
     * so an Owner can be told there was a delivery problem without Tendnote
     * becoming a window onto the provider's suppression history.
     */
    failureClass: text("failure_class"),
    ...timestamps,
  },
  (table) => [
    index("household_invitation_deliveries_invitation_idx").on(table.invitationId),
    index("household_invitation_deliveries_status_idx").on(table.status, table.requestedAt),
  ],
);
