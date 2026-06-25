import { getPersonProfile } from "@tendnote/db";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function PersonDetailPage({
  params,
}: {
  params: Promise<{ personId: string }>;
}) {
  const { personId } = await params;
  const profile = await getPersonProfile(personId);

  if (!profile) {
    notFound();
  }

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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-surface">
          <CardHeader>
            <CardTitle>Memories</CardTitle>
            <CardDescription>Stored context with source and confidence.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {profile.memories.length ? (
              profile.memories.map((memory) => (
                <div className="rounded-lg border bg-background p-3" key={memory.id}>
                  <p className="text-sm">{memory.content}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="outline">{memory.status}</Badge>
                    <Badge variant="outline">{memory.confidence}</Badge>
                    <Badge variant="outline">{memory.sensitivity}</Badge>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No memories captured yet.</p>
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
