import { SearchIcon, UsersRoundIcon } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getOwnerContactImportPreview } from "@/lib/integrations/contact-import-preview-data";

export const dynamic = "force-dynamic";

export default async function ContactsImportPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  const query = Array.isArray(params?.q) ? params?.q[0] : params?.q;
  const preview = await getOwnerContactImportPreview({ query });

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <Link
            className="self-start text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground underline underline-offset-2"
            href="/account"
          >
            Back to account
          </Link>
          <div className="flex flex-col gap-1">
            <h1 className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold tracking-normal">
              Contact import preview
            </h1>
            <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
              Review fixture-backed Google Contacts before anything is saved to Tendnote.
            </p>
          </div>
        </header>

        {!preview.connected ? (
          <section className="rounded-lg border border-dashed bg-surface px-3.5 py-3">
            <p className="text-[length:var(--text-body)] leading-[var(--text-body-line)] text-pretty text-muted-foreground">
              Connect Google Contacts from Account before starting an import preview.
            </p>
          </section>
        ) : (
          <>
            <section className="flex flex-col gap-3">
              <form action="/account/contacts/import" className="flex flex-col gap-2 sm:flex-row">
                <label className="sr-only" htmlFor="contacts-import-search">
                  Search fetched contacts
                </label>
                <div className="relative min-w-0 flex-1">
                  <SearchIcon
                    aria-hidden
                    className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-[length:var(--text-body)] leading-[var(--text-body-line)] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    defaultValue={preview.query}
                    id="contacts-import-search"
                    name="q"
                    placeholder="Search fetched contacts"
                    type="search"
                  />
                </div>
                <Button size="sm" type="submit" variant="outline">
                  Search
                </Button>
              </form>

              <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
                {preview.mode === "search"
                  ? `Showing ${preview.shownCount} search result${
                      preview.shownCount === 1 ? "" : "s"
                    } from ${preview.fetchedCount} fetched contacts.`
                  : `Showing ${preview.shownCount} prioritized candidates from ${
                      preview.fetchedCount
                    } fetched contacts. ${
                      preview.hiddenCount
                    } lower-priority rows are available through search.`}
              </p>
            </section>

            {preview.candidates.length === 0 ? (
              <section className="rounded-lg border border-dashed bg-surface px-3.5 py-3">
                <p className="text-[length:var(--text-body)] leading-[var(--text-body-line)] text-muted-foreground">
                  No fetched contacts match this search.
                </p>
              </section>
            ) : (
              <ul className="flex flex-col divide-y rounded-lg border bg-surface">
                {preview.candidates.map((candidate) => (
                  <li className="flex flex-col gap-2 px-3.5 py-3" key={candidate.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <UsersRoundIcon
                          aria-hidden
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        />
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="truncate text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium">
                            {candidate.displayName}
                          </span>
                          <span className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
                            {candidate.emails[0] ?? candidate.phones[0] ?? "No email or phone"}
                          </span>
                        </div>
                      </div>
                      <Badge variant="outline">{priorityLabel(candidate.priority)}</Badge>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {candidate.reasons.map((reason) => (
                        <span
                          className="rounded-md bg-secondary px-2 py-1 text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-secondary-foreground"
                          key={reason}
                        >
                          {reason}
                        </span>
                      ))}
                      {candidate.birthday ? (
                        <span className="rounded-md bg-secondary px-2 py-1 font-mono text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-secondary-foreground">
                          {candidate.birthday}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function priorityLabel(priority: string): string {
  if (priority === "existing_person_match") return "Existing person";
  if (priority === "birthday") return "Birthday";
  if (priority === "useful_email") return "Email";
  return "Lower priority";
}
