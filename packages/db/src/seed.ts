import { closeDb, getDb } from "./client";
import { mockFollowups, mockMemories, mockPeople } from "./mock-data";
import { followups, memories, people, user } from "./schema";

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

  for (const person of mockPeople) {
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
          notes: person.notes,
          source: person.source,
          updatedAt: new Date(),
        },
      });
  }

  for (const memory of mockMemories) {
    await db
      .insert(memories)
      .values(memory)
      .onConflictDoUpdate({
        target: memories.id,
        set: {
          personId: memory.personId,
          ownerUserId: memory.ownerUserId,
          memoryType: memory.memoryType,
          content: memory.content,
          source: memory.source,
          sensitivity: memory.sensitivity,
          confidence: memory.confidence,
          scope: memory.scope,
          updatedAt: new Date(),
        },
      });
  }

  for (const followup of mockFollowups) {
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
    console.log("Seeded Tendnote mock data.");
  })
  .catch(async (error) => {
    await closeDb();
    console.error(error);
    process.exit(1);
  });
