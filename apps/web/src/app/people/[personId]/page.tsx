import {
  getPersonContextSnapshot,
  getPersonProfile,
  listSuggestedMemoryReviews,
} from "@tendnote/db";
import {
  canUseMemoryProactively,
  canUseSourceRecordProactively,
  type Memory,
  type SourceRecord,
} from "@tendnote/domain";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AssistantPanel } from "@/components/assistant-panel";
import { RelationshipSnapshotCard } from "@/components/relationship-snapshot-card";
import { SuggestedMemoryReviewSection } from "@/components/suggested-memory-review";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentOwnerUserId } from "@/lib/auth/current-user";
import {
  type RelationshipSnapshotView,
  toRelationshipSnapshotView,
} from "@/lib/relationship-snapshot-view";
import {
  type SuggestedMemoryReviewView,
  toSuggestedMemoryReviewView,
} from "@/lib/suggested-memory-review-view";

export const dynamic = "force-dynamic";

type PersonProfile = NonNullable<Awaited<ReturnType<typeof getPersonProfile>>>;

type TrustAwareContext = {
  approvedMemories: Memory[];
  sourceRecords: SourceRecord[];
};

// Source-grounded lead per provenance: user-authored notes read as "you noted",
// while imported/synced sources state where the context came from rather than
// claiming the user wrote it (issue #8 trust framing).
const SOURCE_GROUNDING: Record<string, string> = {
  manual: "You noted",
  agent: "You noted",
  contact_import: "From an imported contact",
  calendar: "From your calendar",
  gmail: "From an email",
  seed: "Sample context",
};

async function loadSuggestedReviews(personId: string): Promise<SuggestedMemoryReviewView[]> {
  try {
    const ownerUserId = await getCurrentOwnerUserId();
    const reviews = await listSuggestedMemoryReviews({ ownerUserId, personId });

    return reviews.map(toSuggestedMemoryReviewView);
  } catch {
    // Review is in-context enrichment; if the store is unavailable the rest of
    // the profile should still render.
    return [];
  }
}

type ProfileContext = TrustAwareContext & {
  snapshot: RelationshipSnapshotView | null;
};

function fallbackContext(profile: PersonProfile): ProfileContext {
  return {
    snapshot: null,
    approvedMemories: profile.memories.filter((memory) => canUseMemoryProactively(memory)),
    sourceRecords: profile.sourceRecords.filter((sourceRecord) =>
      canUseSourceRecordProactively(sourceRecord),
    ),
  };
}

/**
 * Loads the profile's relationship snapshot and trust-aware context through the
 * single shared snapshot-backed read path (PRD #11), so the card and the
 * Memories/Logged-context sections agree and apply the same trust rules. If the
 * store is unavailable, it falls back to the (possibly mock) profile data filtered
 * through the same domain policy helpers, and the card steps aside (ADR 0009).
 */
async function loadProfileContext(
  personId: string,
  profile: PersonProfile,
): Promise<ProfileContext> {
  try {
    const ownerUserId = await getCurrentOwnerUserId();
    const result = await getPersonContextSnapshot({ ownerUserId, personId });

    if (result.context.person) {
      return {
        snapshot: toRelationshipSnapshotView(result),
        approvedMemories: result.context.approvedMemories,
        sourceRecords: result.context.sourceRecords,
      };
    }
  } catch {
    // Fall through to the policy-filtered profile data below.
  }

  return fallbackContext(profile);
}

export default async function PersonDetailPage({
  params,
}: {
  params: Promise<{ personId: string }>;
}) {
  const { personId } = await params;
  const [profile, suggestedReviews] = await Promise.all([
    getPersonProfile(personId),
    loadSuggestedReviews(personId),
  ]);

  if (!profile) {
    notFound();
  }

  const { snapshot, approvedMemories, sourceRecords } = await loadProfileContext(personId, profile);

  return (
    <AppShell>
      <div className="flex flex-col gap-3" id="person-header">
        <h1 className="text-[length:var(--text-display)] leading-[var(--text-display-line)] font-semibold tracking-normal">
          {profile.person.displayName}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{profile.person.relationshipType}</Badge>
          {profile.person.birthday ? (
            <Badge variant="outline">Birthday {profile.person.birthday}</Badge>
          ) : null}
        </div>
        {profile.person.profileBlurb ? (
          <p className="max-w-[68ch] text-[length:var(--text-body)] text-muted-foreground leading-[var(--text-body-line)]">
            {profile.person.profileBlurb}
          </p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          {snapshot ? (
            <RelationshipSnapshotCard view={snapshot} personName={profile.person.displayName} />
          ) : null}

          {suggestedReviews.length ? (
            <Card className="bg-surface" id="needs-review">
              <CardHeader>
                <CardTitle>Needs review</CardTitle>
                <CardDescription>
                  Suggestions drawn from your notes. Save what&rsquo;s right, edit the wording, or
                  dismiss the rest — nothing becomes a confirmed memory until you say so.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SuggestedMemoryReviewSection initialReviews={suggestedReviews} />
              </CardContent>
            </Card>
          ) : null}

          <div className="flex flex-col gap-4">
            <Card className="bg-surface" id="memories">
              <CardHeader>
                <CardTitle>Memories</CardTitle>
                <CardDescription>
                  Confirmed relationship facts, with source and confidence.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {approvedMemories.length ? (
                  approvedMemories.map((memory) => (
                    <div className="rounded-lg border bg-background p-3" key={memory.id}>
                      <p className="text-[length:var(--text-body)] leading-[var(--text-body-line)]">
                        {memory.content}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant="secondary">Confirmed</Badge>
                        <Badge variant="outline">{memory.confidence} confidence</Badge>
                        {memory.sensitivity !== "normal" ? (
                          <Badge variant="outline">{memory.sensitivity}</Badge>
                        ) : null}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-[length:var(--text-small)] text-muted-foreground">
                    No confirmed memories yet. Save a suggestion above or tell the assistant
                    something to remember.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="bg-surface" id="logged-context">
              <CardHeader>
                <CardTitle>Logged context</CardTitle>
                <CardDescription>
                  Things you noted or mentioned. Kept as context for grounding — not confirmed
                  facts.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {sourceRecords.length ? (
                  sourceRecords.map((sourceRecord) => (
                    <div className="rounded-lg border bg-background p-3" key={sourceRecord.id}>
                      <p className="text-[length:var(--text-small)] text-muted-foreground">
                        {SOURCE_GROUNDING[sourceRecord.sourceType] ?? "Logged context"}
                      </p>
                      <p className="mt-0.5 text-[length:var(--text-body)] leading-[var(--text-body-line)]">
                        {sourceRecord.content}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[length:var(--text-caption)] text-muted-foreground">
                          {sourceRecord.createdAt.toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                        {sourceRecord.sensitivity !== "normal" ? (
                          <Badge variant="outline">{sourceRecord.sensitivity}</Badge>
                        ) : null}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-[length:var(--text-small)] text-muted-foreground">
                    Nothing logged yet.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="bg-surface" id="follow-ups">
            <CardHeader>
              <CardTitle>Follow-ups</CardTitle>
              <CardDescription>Open reminders tied to this person.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {profile.followups.length ? (
                profile.followups.map((followup) => (
                  <div className="rounded-lg border bg-background p-3" key={followup.id}>
                    <p className="text-[length:var(--text-body)] leading-[var(--text-body-line)]">
                      {followup.reason}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant="outline">{followup.status}</Badge>
                      <Badge variant="outline">{followup.dueAt.toLocaleDateString()}</Badge>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-[length:var(--text-small)] text-muted-foreground">
                  No follow-ups created yet.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <AssistantPanel
            context={{
              personId: profile.person.id,
              personName: profile.person.displayName,
            }}
          />
        </aside>
      </div>
    </AppShell>
  );
}
