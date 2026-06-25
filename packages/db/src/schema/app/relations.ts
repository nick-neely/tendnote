import { relations } from "drizzle-orm";
import { user } from "../auth";
import { personContextSnapshots } from "./context-snapshots";
import { followups, interactions, messageDrafts } from "./engagement";
import { memories } from "./memories";
import { contactMethods, people } from "./people";
import {
  extractionJobs,
  sourceRecordPeople,
  sourceRecords,
  unresolvedPersonMentions,
} from "./source-records";

export const peopleRelations = relations(people, ({ many, one }) => ({
  owner: one(user, {
    fields: [people.ownerUserId],
    references: [user.id],
  }),
  contactMethods: many(contactMethods),
  memories: many(memories),
  interactions: many(interactions),
  followups: many(followups),
  messageDrafts: many(messageDrafts),
  sourceRecordLinks: many(sourceRecordPeople),
  unresolvedMentions: many(unresolvedPersonMentions),
  contextSnapshot: many(personContextSnapshots),
}));

export const personContextSnapshotsRelations = relations(personContextSnapshots, ({ one }) => ({
  person: one(people, {
    fields: [personContextSnapshots.personId],
    references: [people.id],
  }),
  owner: one(user, {
    fields: [personContextSnapshots.ownerUserId],
    references: [user.id],
  }),
}));

export const contactMethodsRelations = relations(contactMethods, ({ one }) => ({
  person: one(people, {
    fields: [contactMethods.personId],
    references: [people.id],
  }),
}));

export const memoriesRelations = relations(memories, ({ one }) => ({
  person: one(people, {
    fields: [memories.personId],
    references: [people.id],
  }),
  owner: one(user, {
    fields: [memories.ownerUserId],
    references: [user.id],
  }),
  sourceRecord: one(sourceRecords, {
    fields: [memories.sourceRecordId],
    references: [sourceRecords.id],
  }),
}));

export const sourceRecordsRelations = relations(sourceRecords, ({ many, one }) => ({
  owner: one(user, {
    fields: [sourceRecords.ownerUserId],
    references: [user.id],
  }),
  people: many(sourceRecordPeople),
  unresolvedMentions: many(unresolvedPersonMentions),
  memories: many(memories),
  extractionJobs: many(extractionJobs),
}));

export const sourceRecordPeopleRelations = relations(sourceRecordPeople, ({ one }) => ({
  sourceRecord: one(sourceRecords, {
    fields: [sourceRecordPeople.sourceRecordId],
    references: [sourceRecords.id],
  }),
  person: one(people, {
    fields: [sourceRecordPeople.personId],
    references: [people.id],
  }),
}));

export const unresolvedPersonMentionsRelations = relations(unresolvedPersonMentions, ({ one }) => ({
  sourceRecord: one(sourceRecords, {
    fields: [unresolvedPersonMentions.sourceRecordId],
    references: [sourceRecords.id],
  }),
  resolvedPerson: one(people, {
    fields: [unresolvedPersonMentions.resolvedPersonId],
    references: [people.id],
  }),
}));

export const extractionJobsRelations = relations(extractionJobs, ({ one }) => ({
  sourceRecord: one(sourceRecords, {
    fields: [extractionJobs.sourceRecordId],
    references: [sourceRecords.id],
  }),
}));

export const followupsRelations = relations(followups, ({ one }) => ({
  person: one(people, {
    fields: [followups.personId],
    references: [people.id],
  }),
  owner: one(user, {
    fields: [followups.ownerUserId],
    references: [user.id],
  }),
}));

export const messageDraftsRelations = relations(messageDrafts, ({ one }) => ({
  person: one(people, {
    fields: [messageDrafts.personId],
    references: [people.id],
  }),
  owner: one(user, {
    fields: [messageDrafts.ownerUserId],
    references: [user.id],
  }),
}));
