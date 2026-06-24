import { searchPeople } from "@tendnote/db";
import { AppShell } from "@/components/app-shell";
import { AssistantPanel } from "@/components/assistant-panel";
import { PersonCard } from "@/components/person-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function Home() {
  const people = await searchPeople({ limit: 3 });

  return (
    <AppShell>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Badge className="w-fit" variant="secondary">
              Phase 0 foundation
            </Badge>
            <h1 className="text-3xl font-semibold tracking-normal">
              Relationship memory, local first.
            </h1>
            <p className="max-w-2xl text-muted-foreground">
              Tendnote keeps people, memories, follow-ups, and drafts in one private workspace with
              local Docker services for development.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Postgres</CardTitle>
                <CardDescription>Local Docker database</CardDescription>
              </CardHeader>
              <CardContent>
                <Badge variant="outline">Drizzle ready</Badge>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Redis</CardTitle>
                <CardDescription>Auth cache and rate limits</CardDescription>
              </CardHeader>
              <CardContent>
                <Badge variant="outline">Better Auth</Badge>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Eve</CardTitle>
                <CardDescription>Filesystem agent skeleton</CardDescription>
              </CardHeader>
              <CardContent>
                <Badge variant="outline">search_people</Badge>
              </CardContent>
            </Card>
          </div>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-medium">People</h2>
                <p className="text-sm text-muted-foreground">
                  Seed records render from local Postgres when available, with a mock fallback for
                  first run.
                </p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {people.map((person) => (
                <PersonCard key={person.id} person={person} />
              ))}
            </div>
          </section>
        </section>

        <AssistantPanel />
      </div>
    </AppShell>
  );
}
