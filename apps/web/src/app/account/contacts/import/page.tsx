import type { LucideIcon } from "lucide-react";
import { CheckIcon, SearchIcon, TriangleAlertIcon, UsersRoundIcon } from "lucide-react";
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
  importError?: string | string[];
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
  const importError = readParam(params?.importError, "");
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
              Review contacts from Google before anything is saved to Tendnote.
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
                  Added {created} new {created === "1" ? "person" : "people"}, {updated} updated{" "}
                  {updated === "1" ? "person" : "people"}, {methods} contact{" "}
                  {methods === "1" ? "method" : "methods"}, and {birthdays}{" "}
                  {birthdays === "1" ? "birthday" : "birthdays"}. These can be edited or archived
                  from people profiles.
                </p>
              </section>
            ) : null}
            {importError ? <ImportErrorBanner message={importError} /> : null}
            {preview.errorMessage ? <ImportErrorBanner message={preview.errorMessage} /> : null}
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
      <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-surface">
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
              <ReviewStateBadge state={candidate.reviewState} />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">{priorityLabel(candidate.priority)}</Badge>
              {candidate.reasons.map((reason) => (
                <Badge key={reason} variant="secondary">
                  {reason}
                </Badge>
              ))}
              {candidate.birthday ? (
                <Badge className="font-mono" variant="outline">
                  {candidate.birthday}
                </Badge>
              ) : null}
            </div>

            {candidate.conflicts.length > 0 || candidate.advisoryMatches.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {candidate.conflicts.map((conflict) => (
                  <li
                    className="flex items-start gap-1.5 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground"
                    key={`${conflict.type}:${conflict.message}`}
                  >
                    <TriangleAlertIcon
                      aria-hidden
                      className="mt-0.5 size-3.5 shrink-0 text-accent"
                    />
                    <span>{conflict.message}</span>
                  </li>
                ))}
                {candidate.advisoryMatches.map((match) => (
                  <li
                    className="flex items-start gap-1.5 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground"
                    key={`${match.personId}:${match.reason}`}
                  >
                    <UsersRoundIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Advisory: {match.displayName} · {match.reason}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
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
  // Advisory matches are only "possible" people, so the owner picks one deliberately;
  // a confirmed contact-method match is a single known person applied without a chooser.
  const needsTargetChoice = candidate.reviewState === "advisory_match";
  const birthdayConflict = candidate.conflicts.some((conflict) => conflict.type === "birthday");
  const hasNamedTarget = targetOptions.length > 0;
  // A contact matched to more than one person can't be attached safely from here, and
  // the other people can't be named on this screen — resolve it on their profiles.
  const unresolvableTarget = !hasNamedTarget && !canCreate;

  return (
    // Recessed footer zone: the source contact stays on the card's --surface; the
    // decision steps down onto --panel, full-bleed to the card edges (clipped to the
    // card's rounded corners by the list's overflow-hidden). Flat — border + fill,
    // no shadow, no nested card, no side stripe.
    <div className="-mx-3.5 -mb-3 mt-1 flex flex-col gap-2.5 border-t bg-panel px-3.5 py-3">
      {hasNamedTarget ? (
        <form action={confirmContactImportCandidateAction} className="flex flex-col gap-2">
          <input name="candidateId" type="hidden" value={candidate.id} />
          {needsTargetChoice ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-foreground">
                Choose target person
              </legend>
              {targetOptions.map((target) => (
                <label
                  className="flex items-center gap-2 text-[length:var(--text-small)] leading-[var(--text-small-line)]"
                  key={target.id}
                >
                  <input
                    className={RADIO_CLASS}
                    name="targetPersonId"
                    required
                    type="radio"
                    value={target.id}
                  />
                  <span>{target.label}</span>
                </label>
              ))}
            </fieldset>
          ) : (
            <input name="targetPersonId" type="hidden" value={targetOptions[0]?.id} />
          )}
          {birthdayConflict ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-[length:var(--text-small)] font-medium text-muted-foreground">
                Birthday
              </legend>
              <label className="flex items-center gap-2 text-[length:var(--text-small)] leading-[var(--text-small-line)]">
                <input
                  className={RADIO_CLASS}
                  defaultChecked
                  name="birthdayChoice"
                  type="radio"
                  value="existing"
                />
                <span>Keep Tendnote birthday</span>
              </label>
              <label className="flex items-center gap-2 text-[length:var(--text-small)] leading-[var(--text-small-line)]">
                <input
                  className={RADIO_CLASS}
                  name="birthdayChoice"
                  type="radio"
                  value="provider"
                />
                <span>Use provider birthday</span>
              </label>
            </fieldset>
          ) : null}
          <Button className="self-start" size="sm" type="submit" variant="outline">
            Apply explicit resolution
          </Button>
        </form>
      ) : null}
      {canCreate && !hasNamedTarget ? (
        <form action={confirmContactImportCandidateAction}>
          <input name="candidateId" type="hidden" value={candidate.id} />
          <input name="createPerson" type="hidden" value="true" />
          <Button size="sm" type="submit" variant="outline">
            Create new person
          </Button>
        </form>
      ) : null}
      {unresolvableTarget ? (
        <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
          This contact matches more than one person. Open those people to attach or merge it, or
          skip it here.
        </p>
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

const RADIO_CLASS =
  "size-4 shrink-0 rounded-full [accent-color:var(--primary)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

// Clay accent is the system's "needs review" weight (DESIGN §3), held to a single
// state badge and only for genuine conflicts — not applied to every chip. The icon
// keeps the state legible without relying on color alone.
const REVIEW_STATE_META: Record<
  string,
  { label: string; tone: "neutral" | "review"; Icon?: LucideIcon }
> = {
  safe_recommendation: { label: "Safe", tone: "neutral", Icon: CheckIcon },
  conflict: { label: "Conflict", tone: "review", Icon: TriangleAlertIcon },
  ambiguous_duplicate: { label: "Ambiguous", tone: "review", Icon: TriangleAlertIcon },
  advisory_match: { label: "Advisory", tone: "neutral", Icon: UsersRoundIcon },
  individual_review: { label: "Review", tone: "neutral" },
  weak_match: { label: "Weak", tone: "neutral" },
};

function ReviewStateBadge({ state }: { state: string }) {
  const meta = REVIEW_STATE_META[state] ?? { label: "Review", tone: "neutral" as const };
  const Icon = meta.Icon;

  return (
    <Badge
      className={meta.tone === "review" ? "border-accent/30 bg-accent/10 text-accent" : undefined}
      variant="outline"
    >
      {Icon ? <Icon aria-hidden data-icon="inline-start" /> : null}
      {meta.label}
    </Badge>
  );
}

function ImportErrorBanner({ message }: { message: string }) {
  return (
    <section
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-3"
      role="alert"
    >
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
      <p className="text-[length:var(--text-body)] leading-[var(--text-body-line)] text-pretty text-destructive">
        {message}
      </p>
    </section>
  );
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
