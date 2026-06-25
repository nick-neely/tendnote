import {
  type CreatePersonInput,
  createPersonSchema,
  type Person,
  type SearchPeopleInput,
  searchPeopleSchema,
} from "@tendnote/domain";
import { and, eq, ilike, or, type SQL } from "drizzle-orm";
import { getDb, hasDatabaseUrl } from "../client";
import {
  mockFollowups,
  mockMemories,
  mockPeople,
  mockSourceRecordPeople,
  mockSourceRecords,
} from "../mock-data";
import {
  auditLog,
  followups,
  memories,
  people,
  sourceRecordPeople,
  sourceRecords,
} from "../schema";

function logMockFallback(error: unknown) {
  if (process.env.TENDNOTE_STRICT_DB === "true") {
    throw error;
  }

  console.warn("Tendnote database unavailable. Falling back to mock seed data.", error);
}

/** Owner-scoped input for {@link createPerson}: the resolved owner plus the new profile. */
export type CreatePersonMutationInput = CreatePersonInput & { ownerUserId: string };

/**
 * Creates a person under the resolved owner. This is the single shared
 * owner-scoped entry point for explicit add-person intent (ADR 0001, ADR 0033):
 * the Eve `create_person` tool calls it today, and the web app should call the
 * same path rather than inserting people itself. Person creation always requires
 * explicit intent — a casual ambiguous mention never reaches here. Falls back to
 * a synthesized person when the database is unavailable so the local dev loop
 * keeps working.
 */
export async function createPerson(input: CreatePersonMutationInput): Promise<Person> {
  const parsed = createPersonSchema.parse(input);
  const values = {
    ownerUserId: input.ownerUserId,
    displayName: parsed.displayName,
    firstName: parsed.firstName ?? null,
    lastName: parsed.lastName ?? null,
    birthday: parsed.birthday ?? null,
    relationshipType: parsed.relationshipType ?? "other",
    closenessLevel: parsed.closenessLevel ?? 3,
    profileBlurb: parsed.profileBlurb ?? null,
    source: parsed.source ?? "manual",
  };

  const synthesize = (): Person => {
    const now = new Date();
    return { id: crypto.randomUUID(), createdAt: now, updatedAt: now, ...values };
  };

  if (!hasDatabaseUrl()) {
    return synthesize();
  }

  try {
    const [person] = await getDb().insert(people).values(values).returning();

    if (!person) {
      throw new Error("Failed to create person.");
    }

    try {
      await getDb()
        .insert(auditLog)
        .values({
          ownerUserId: input.ownerUserId,
          action: "person.create",
          entityType: "person",
          entityId: person.id,
          metadataJson: { displayName: person.displayName, source: person.source },
        });
    } catch {
      // The person is already persisted; an audit-log failure must not lose it.
    }

    return person;
  } catch (error) {
    logMockFallback(error);
    return synthesize();
  }
}

export async function searchPeople(input: SearchPeopleInput = {}) {
  const filters = searchPeopleSchema.parse(input);

  const mockResults = () =>
    mockPeople
      .filter((person) => {
        const matchesQuery =
          !filters.query || person.displayName.toLowerCase().includes(filters.query.toLowerCase());
        const matchesRelationship =
          !filters.relationshipType || person.relationshipType === filters.relationshipType;

        return matchesQuery && matchesRelationship;
      })
      .slice(0, filters.limit);

  if (!hasDatabaseUrl()) {
    return mockResults();
  }

  try {
    const where: SQL[] = [];

    if (filters.query) {
      const queryFilter = or(
        ilike(people.displayName, `%${filters.query}%`),
        ilike(people.firstName, `%${filters.query}%`),
        ilike(people.lastName, `%${filters.query}%`),
      );

      if (queryFilter) {
        where.push(queryFilter);
      }
    }

    if (filters.relationshipType) {
      where.push(eq(people.relationshipType, filters.relationshipType));
    }

    return await getDb()
      .select()
      .from(people)
      .where(where.length ? and(...where) : undefined)
      .limit(filters.limit)
      .orderBy(people.displayName);
  } catch (error) {
    logMockFallback(error);
    return mockResults();
  }
}

export async function getPersonProfile(personId: string) {
  const mockResult = () => {
    const person = mockPeople.find((candidate) => candidate.id === personId);

    if (!person) {
      return null;
    }

    return (
      mockPeople
        .filter((candidate) => candidate.id === personId)
        .map((person) => ({
          person,
          memories: mockMemories.filter((memory) => memory.personId === personId),
          followups: mockFollowups.filter((followup) => followup.personId === personId),
          sourceRecords: mockSourceRecords.filter((sourceRecord) =>
            mockSourceRecordPeople.some(
              (link) => link.personId === personId && link.sourceRecordId === sourceRecord.id,
            ),
          ),
        }))[0] ?? null
    );
  };

  if (!hasDatabaseUrl()) {
    return mockResult();
  }

  try {
    const [person] = await getDb().select().from(people).where(eq(people.id, personId)).limit(1);

    if (!person) {
      return null;
    }

    const [personMemories, personFollowups, personSourceRecords] = await Promise.all([
      getDb().select().from(memories).where(eq(memories.personId, personId)),
      getDb().select().from(followups).where(eq(followups.personId, personId)),
      getDb()
        .select({ sourceRecord: sourceRecords })
        .from(sourceRecordPeople)
        .innerJoin(sourceRecords, eq(sourceRecordPeople.sourceRecordId, sourceRecords.id))
        .where(eq(sourceRecordPeople.personId, personId)),
    ]);

    return {
      person,
      memories: personMemories,
      followups: personFollowups,
      sourceRecords: personSourceRecords.map((row) => row.sourceRecord),
    };
  } catch (error) {
    logMockFallback(error);
    return mockResult();
  }
}
