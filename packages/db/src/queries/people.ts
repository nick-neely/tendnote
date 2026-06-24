import { type SearchPeopleInput, searchPeopleSchema } from "@tendnote/domain";
import { and, eq, ilike, or, type SQL } from "drizzle-orm";
import { getDb, hasDatabaseUrl } from "../client";
import { mockFollowups, mockMemories, mockPeople } from "../mock-data";
import { followups, memories, people } from "../schema";

function logMockFallback(error: unknown) {
  if (process.env.TENDNOTE_STRICT_DB === "true") {
    throw error;
  }

  console.warn("Tendnote database unavailable. Falling back to mock seed data.", error);
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

    const [personMemories, personFollowups] = await Promise.all([
      getDb().select().from(memories).where(eq(memories.personId, personId)),
      getDb().select().from(followups).where(eq(followups.personId, personId)),
    ]);

    return {
      person,
      memories: personMemories,
      followups: personFollowups,
    };
  } catch (error) {
    logMockFallback(error);
    return mockResult();
  }
}
