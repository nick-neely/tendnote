/**
 * How the conversation rail is sectioned.
 *
 * A flat list of forty timestamps is a wall; the same list under four headings
 * is a memory aid. The buckets are calendar-relative, not duration-relative, so
 * a conversation from 11pm last night reads as "Yesterday" the way the person
 * remembers it rather than "17 hours ago".
 */
export type AssistantConversationBucketId = "today" | "yesterday" | "previous7Days" | "older";

export type AssistantConversationBucket<TConversation> = {
  id: AssistantConversationBucketId;
  label: string;
  conversations: TConversation[];
};

/** Sentence-case, plain, and the same words the rest of the notebook uses. */
const BUCKET_LABELS: Readonly<Record<AssistantConversationBucketId, string>> = {
  today: "Today",
  yesterday: "Yesterday",
  previous7Days: "Previous 7 days",
  older: "Older",
};

const BUCKET_ORDER: readonly AssistantConversationBucketId[] = [
  "today",
  "yesterday",
  "previous7Days",
  "older",
];

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Midnight at the start of the day `date` falls in, in the reader's own zone. */
function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function assistantConversationBucket(
  lastActivityAt: Date,
  now: Date,
): AssistantConversationBucketId {
  const today = startOfLocalDay(now);
  const day = startOfLocalDay(lastActivityAt);

  // A clock skew or a future-dated row belongs with today rather than nowhere.
  if (day >= today) return "today";
  if (day >= today - MILLISECONDS_PER_DAY) return "yesterday";
  if (day > today - 7 * MILLISECONDS_PER_DAY) return "previous7Days";

  return "older";
}

/**
 * Section an already-ordered conversation list, dropping the headings that would
 * stand over nothing.
 *
 * The input order is preserved inside each bucket, so the query's
 * `last_activity_at desc` is what decides the order and this function never
 * re-sorts. Empty buckets are omitted: a heading with no rows under it is a
 * broken promise, not a placeholder.
 */
export function groupAssistantConversations<TConversation extends { lastActivityAt: Date }>(
  conversations: readonly TConversation[],
  now: Date,
): AssistantConversationBucket<TConversation>[] {
  const byBucket = new Map<AssistantConversationBucketId, TConversation[]>();

  for (const conversation of conversations) {
    const id = assistantConversationBucket(conversation.lastActivityAt, now);
    const existing = byBucket.get(id);
    if (existing) {
      existing.push(conversation);
    } else {
      byBucket.set(id, [conversation]);
    }
  }

  return BUCKET_ORDER.flatMap((id) => {
    const bucketConversations = byBucket.get(id);
    if (!bucketConversations) return [];

    return [{ id, label: BUCKET_LABELS[id], conversations: bucketConversations }];
  });
}
