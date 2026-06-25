import { closeDb, getDb } from "./client";
import {
  demoFollowups,
  demoMemories,
  demoPeople,
  demoSourceRecordPeople,
  demoSourceRecords,
} from "./demo-data";
import { followups, memories, people, sourceRecordPeople, sourceRecords, user } from "./schema";

const ownerUserId = "demo-user";

async function seed() {
  const db = getDb();

  await db
    .insert(user)
    .values({
      id: ownerUserId,
      name: "Demo User",
      email: "demo@tendnote.local",
      emailVerified: true,
    })
    .onConflictDoUpdate({
      target: user.id,
      set: {
        name: "Demo User",
        email: "demo@tendnote.local",
        emailVerified: true,
        updatedAt: new Date(),
      },
    });

  for (const person of demoPeople) {
    await db
      .insert(people)
      .values(person)
      .onConflictDoUpdate({
        target: people.id,
        set: {
          displayName: person.displayName,
          firstName: person.firstName,
          lastName: person.lastName,
          birthday: person.birthday,
          relationshipType: person.relationshipType,
          closenessLevel: person.closenessLevel,
          profileBlurb: person.profileBlurb,
          source: person.source,
          updatedAt: new Date(),
        },
      });
  }

  for (const sourceRecord of demoSourceRecords) {
    await db
      .insert(sourceRecords)
      .values(sourceRecord)
      .onConflictDoUpdate({
        target: sourceRecords.id,
        set: {
          ownerUserId: sourceRecord.ownerUserId,
          sourceType: sourceRecord.sourceType,
          content: sourceRecord.content,
          rawContent: sourceRecord.rawContent,
          retentionPolicy: sourceRecord.retentionPolicy,
          status: sourceRecord.status,
          confidence: sourceRecord.confidence,
          sensitivity: sourceRecord.sensitivity,
          scope: sourceRecord.scope,
          importance: sourceRecord.importance,
          metadataJson: sourceRecord.metadataJson,
          updatedAt: new Date(),
        },
      });
  }

  for (const sourceRecordPerson of demoSourceRecordPeople) {
    await db
      .insert(sourceRecordPeople)
      .values(sourceRecordPerson)
      .onConflictDoUpdate({
        target: sourceRecordPeople.id,
        set: {
          sourceRecordId: sourceRecordPerson.sourceRecordId,
          personId: sourceRecordPerson.personId,
          role: sourceRecordPerson.role,
        },
      });
  }

  for (const memory of demoMemories) {
    await db
      .insert(memories)
      .values(memory)
      .onConflictDoUpdate({
        target: memories.id,
        set: {
          personId: memory.personId,
          ownerUserId: memory.ownerUserId,
          sourceRecordId: memory.sourceRecordId,
          memoryType: memory.memoryType,
          content: memory.content,
          status: memory.status,
          importance: memory.importance,
          sensitivity: memory.sensitivity,
          confidence: memory.confidence,
          scope: memory.scope,
          approvedAt: memory.approvedAt,
          dismissedAt: memory.dismissedAt,
          updatedAt: new Date(),
        },
      });
  }

  for (const followup of demoFollowups) {
    await db
      .insert(followups)
      .values(followup)
      .onConflictDoUpdate({
        target: followups.id,
        set: {
          personId: followup.personId,
          ownerUserId: followup.ownerUserId,
          reason: followup.reason,
          dueAt: followup.dueAt,
          status: followup.status,
          cadence: followup.cadence,
          lastPromptedAt: followup.lastPromptedAt,
          updatedAt: new Date(),
        },
      });
  }
}

seed()
  .then(async () => {
    await closeDb();
    console.log("Seeded Tendnote demo data.");
  })
  .catch(async (error) => {
    await closeDb();
    console.error(error);
    process.exit(1);
  });
