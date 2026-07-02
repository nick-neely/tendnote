import { SearchIcon, UsersRoundIcon } from "lucide-react";
import Link from "next/link";
import {
  confirmContactImportCandidateAction,
  confirmSafeContactImportCandidatesAction,
  skipContactImportCandidateAction,
} from "@/app/actions/contact-import";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getOwnerContactImportPreview } from "@/lib/integrations/contact-import-preview-data";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string | string[];
  confirmed?: string | string[];
  created?: string | string[];
  updated?: string | string[];
  methods?: string | string[];
  birthdays?: string | string[];
};

export default async function ContactsImportPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const query = readParam(params?.q, "");
  const confirmed = readParam(params?.confirmed, "");
  const created = readParam(params?.created);
  const updated = readParam(params?.updated);
  const methods = readParam(params?.methods);
  const birthdays = readParam(params?.birthdays);
  const preview = await getOwnerContactImportPreview({ query });
  const safeCandidates = preview.candidates.filter((candidate) => candidate.safeBulkEligible);
  const reviewCandidates = preview.candidates.filter((candidate) => !candidate.safeBulkEligible);

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
            {confirmed ? (
              <section className="rounded-lg border bg-surface px-3.5 py-3">
                <p className="text-[length:var(--text-body)] leading-[var(--text-body-line)] text-pretty">
                  Confirmed {confirmed} contact import candidate{confirmed === "1" ? "" : "s"}.
                  {created} new {created === "1" ? "person" : "people"}, {updated} updated{" "}
                  {updated === "1" ? "person" : "people"}, {methods} contact{" "}
                  {methods === "1" ? "method" : "methods"}, and {birthdays}{" "}
                  {birthdays === "1" ? "birthday" : "birthdays"} changed. Imported fields are now
                  normal Tendnote profile data and can be edited or archived from people profiles.
                </p>
              </section>
            ) : null}
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
              {safeCandidates.length > 0 ? (
                <form action={confirmSafeContactImportCandidatesAction}>
                  {safeCandidates.map((candidate) => (
                    <input
                      key={candidate.id}
                      name="candidateId"
                      type="hidden"
                      value={candidate.id}
                    />
                  ))}
                  <Button size="sm" type="submit">
                    Confirm safe recommendations
                  </Button>
                </form>
              ) : null}

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
              <div className="flex flex-col gap-6">
                {safeCandidates.length > 0 ? (
                  <CandidateList
                    candidates={safeCandidates}
                    description="No conflicts, ambiguous duplicates, weak signals, or unusual field changes."
                    title="Safe recommendations"
                  />
                ) : null}
                {reviewCandidates.length > 0 ? (
                  <CandidateList
                    candidates={reviewCandidates}
                    description="Review these individually before any future confirmation step."
                    showExplicitConfirmation
                    title="Needs individual review"
                  />
                ) : null}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function CandidateList({
  title,
  description,
  candidates,
  showExplicitConfirmation = false,
}: {
  title: string;
  description: string;
  candidates: NonNullable<Awaited<ReturnType<typeof getOwnerContactImportPreview>>>["candidates"];
  showExplicitConfirmation?: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground">
          {title}
        </h2>
        <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-pretty text-muted-foreground">
          {description}
        </p>
      </div>
      <ul className="flex flex-col divide-y rounded-lg border bg-surface">
        {candidates.map((candidate) => (
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
              <Badge variant="outline">{reviewStateLabel(candidate.reviewState)}</Badge>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline">{priorityLabel(candidate.priority)}</Badge>
              {candidate.reasons.map((reason) => (
                <span
                  className="rounded-md bg-secondary px-2 py-1 text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-secondary-foreground"
                  key={reason}
                >
                  {reason}
                </span>
              ))}
              {candidate.conflicts.map((conflict) => (
                <span
                  className="rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-accent"
                  key={`${conflict.type}:${conflict.message}`}
                >
                  {conflict.message}
                </span>
              ))}
              {candidate.advisoryMatches.map((match) => (
                <span
                  className="rounded-md border bg-background px-2 py-1 text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground"
                  key={`${match.personId}:${match.reason}`}
                >
                  Advisory: {match.displayName} · {match.reason}
                </span>
              ))}
              {candidate.birthday ? (
                <span className="rounded-md bg-secondary px-2 py-1 font-mono text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-secondary-foreground">
                  {candidate.birthday}
                </span>
              ) : null}
            </div>
            {showExplicitConfirmation ? <ReviewResolutionControls candidate={candidate} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReviewResolutionControls({
  candidate,
}: {
  candidate: NonNullable<
    Awaited<ReturnType<typeof getOwnerContactImportPreview>>
  >["candidates"][number];
}) {
  const targetOptions = reviewTargetOptions(candidate);
  const canCreate =
    candidate.reviewState === "individual_review" || candidate.reviewState === "weak_match";
  const needsTarget =
    candidate.reviewState === "ambiguous_duplicate" ||
    candidate.reviewState === "advisory_match" ||
    (candidate.reviewState === "weak_match" && targetOptions.length === 0);
  const birthdayConflict = candidate.conflicts.some((conflict) => conflict.type === "birthday");
  const showApplyForm = targetOptions.length > 0 || needsTarget || birthdayConflict;

  return (
    <div className="flex flex-col gap-2 border-t pt-2">
      {showApplyForm ? (
        <form action={confirmContactImportCandidateAction} className="flex flex-col gap-2">
          <input name="candidateId" type="hidden" value={candidate.id} />
          {targetOptions.length === 1 && !needsTarget ? (
            <input name="targetPersonId" type="hidden" value={targetOptions[0]?.id} />
          ) : null}
          {targetOptions.length > 0 && needsTarget ? (
            <fieldset className="flex flex-col gap-1.5 text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
              <span>Choose target person</span>
              {targetOptions.map((target) => (
                <label className="flex items-center gap-1.5" key={target.id}>
                  <input name="targetPersonId" required type="radio" value={target.id} />
                  {target.label}
                </label>
              ))}
            </fieldset>
          ) : null}
          {targetOptions.length === 0 && needsTarget ? (
            <label className="flex flex-col gap-1 text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
              Target person ID
              <input
                className="h-8 rounded-md border bg-background px-2 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                name="targetPersonId"
                placeholder="Paste a Tendnote person ID"
                required
              />
            </label>
          ) : null}
          {birthdayConflict ? (
            <fieldset className="flex flex-wrap gap-2 text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
              <label className="flex items-center gap-1.5">
                <input defaultChecked name="birthdayChoice" type="radio" value="existing" />
                Keep Tendnote birthday
              </label>
              <label className="flex items-center gap-1.5">
                <input name="birthdayChoice" type="radio" value="provider" />
                Use provider birthday
              </label>
            </fieldset>
          ) : null}
          <Button size="sm" type="submit" variant="outline">
            Apply explicit resolution
          </Button>
        </form>
      ) : null}
      {canCreate && targetOptions.length === 0 ? (
        <form action={confirmContactImportCandidateAction}>
          <input name="candidateId" type="hidden" value={candidate.id} />
          <input name="createPerson" type="hidden" value="true" />
          <Button size="sm" type="submit" variant="outline">
            Create new person
          </Button>
        </form>
      ) : null}
      <form action={skipContactImportCandidateAction}>
        <input name="candidateId" type="hidden" value={candidate.id} />
        <Button size="sm" type="submit" variant="ghost">
          Skip candidate
        </Button>
      </form>
    </div>
  );
}

function reviewStateLabel(state: string): string {
  if (state === "safe_recommendation") return "Safe";
  if (state === "conflict") return "Conflict";
  if (state === "ambiguous_duplicate") return "Ambiguous";
  if (state === "advisory_match") return "Advisory";
  if (state === "individual_review") return "Review";
  return "Weak";
}

function priorityLabel(priority: string): string {
  if (priority === "existing_person_match") return "Existing person";
  if (priority === "birthday") return "Birthday";
  if (priority === "useful_email") return "Email";
  return "Lower priority";
}

function readParam(value: string | string[] | undefined, fallback = "0"): string {
  return Array.isArray(value) ? (value[0] ?? fallback) : (value ?? fallback);
}

function reviewTargetOptions(
  candidate: NonNullable<
    Awaited<ReturnType<typeof getOwnerContactImportPreview>>
  >["candidates"][number],
): Array<{ id: string; label: string }> {
  const targets = [
    candidate.matchedPerson
      ? { id: candidate.matchedPerson.id, label: candidate.matchedPerson.displayName }
      : null,
    ...candidate.advisoryMatches.map((match) => ({
      id: match.personId,
      label: `${match.displayName} (${match.reason})`,
    })),
    ...candidate.matchSignals.map((signal) => ({
      id: signal.matchedPersonId,
      label: `Person ${signal.matchedPersonId}`,
    })),
  ].filter((target): target is { id: string; label: string } => target !== null);
  const seen = new Set<string>();

  return targets.filter((target) => {
    if (seen.has(target.id)) {
      return false;
    }
    seen.add(target.id);
    return true;
  });
}
