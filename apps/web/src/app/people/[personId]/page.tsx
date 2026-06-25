import { getPersonProfile, listSuggestedMemoryReviews } from "@tendnote/db";
import { isDurableMemoryFact } from "@tendnote/domain";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SuggestedMemoryReviewSection } from "@/components/suggested-memory-review";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentOwnerUserId } from "@/lib/auth/current-user";
import {
  type SuggestedMemoryReviewView,
  toSuggestedMemoryReviewView,
} from "@/lib/suggested-memory-review-view";

export const dynamic = "force-dynamic";

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

  // Only approved memories are durable, confirmed facts (ADR 0004).
  const confirmedMemories = profile.memories.filter(isDurableMemoryFact);

  return (
    <AppShell>
      <div className="flex flex-col gap-3">
        <h1 className="text-[length:var(--text-display)] leading-[var(--text-display-line)] font-semibold tracking-normal">
          {profile.person.displayName}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{profile.person.relationshipType}</Badge>
          <Badge variant="outline">Closeness {profile.person.closenessLevel}</Badge>
          {profile.person.birthday ? (
            <Badge variant="outline">{profile.person.birthday}</Badge>
          ) : null}
        </div>
      </div>

      {suggestedReviews.length ? (
        <Card className="bg-surface">
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-surface">
          <CardHeader>
            <CardTitle>Memories</CardTitle>
            <CardDescription>
              Confirmed relationship facts, with source and confidence.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {confirmedMemories.length ? (
              confirmedMemories.map((memory) => (
                <div className="rounded-lg border bg-background p-3" key={memory.id}>
                  <p className="text-sm">{memory.content}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="secondary">Confirmed</Badge>
                    <Badge variant="outline">{memory.confidence}</Badge>
                    <Badge variant="outline">{memory.sensitivity}</Badge>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No confirmed memories yet.</p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-surface">
          <CardHeader>
            <CardTitle>Follow-Ups</CardTitle>
            <CardDescription>Open reminders tied to this person.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {profile.followups.length ? (
              profile.followups.map((followup) => (
                <div className="rounded-lg border bg-background p-3" key={followup.id}>
                  <p className="text-sm">{followup.reason}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="outline">{followup.status}</Badge>
                    <Badge variant="outline">{followup.dueAt.toLocaleDateString()}</Badge>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No follow-ups created yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
