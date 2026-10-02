import { Button } from "@tendnote/ui/button";
import type { Metadata } from "next";
import Link from "next/link";
import {
  inlineLink,
  PageHeader,
  Section,
  SplitSection,
  sectionTitle,
  smallText,
  TermList,
} from "@/components/page-section";
import { SUPPORT_EMAIL } from "@/lib/offer";
import { isRestoreDrillCurrent, RECOVERY_SENTENCE } from "@/lib/restore-drill";

export const metadata: Metadata = {
  title: "Privacy & AI",
  description:
    "Where your notes go, who can see them, how AI processes them, and how to export or delete everything.",
};

// Rebuilt daily so the recovery sentence leaves the page on the day a drill
// goes stale, without anyone remembering to redeploy.
export const revalidate = 86400;

const flow = [
  {
    title: "You write it",
    body: "A note, a capture, a question. It is saved to your account in Tendnote's database.",
  },
  {
    title: "A model reads it, briefly",
    body: "To suggest a Memory or answer a question, the relevant notes go to a model. The model keeps nothing and learns nothing from them.",
  },
  {
    title: "You decide what stays",
    body: "Suggestions wait for you. Nothing becomes a Memory, a follow-up, or a message without your yes.",
  },
  {
    title: "It comes back to you",
    body: "On Today, in your brief, or in Eve's answer, with the note it came from beside it.",
  },
];

export default function PrivacyAndAiPage() {
  const recoveryCurrent = isRestoreDrillCurrent();

  return (
    <>
      <PageHeader
        lede="Tendnote holds what people tell you in confidence. This page explains, in plain words, where that goes and who can see it. The Privacy Policy is the formal version."
        title="What happens to what you write."
      />

      <Section className="bg-surface" labelledBy="flow-title">
        <div className="flex flex-col gap-10">
          <h2 className={sectionTitle} id="flow-title">
            The path a note takes
          </h2>
          <ol className="grid gap-8 md:grid-cols-4 md:gap-6">
            {flow.map((step) => (
              <li
                className="flex flex-col gap-3 border-t-2 border-primary/40 pt-4"
                key={step.title}
              >
                <p className="text-[length:var(--text-title)] leading-[var(--text-title-line)] font-semibold">
                  {step.title}
                </p>
                <p className="text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      <SplitSection
        aside={
          <p className="max-w-[44ch] text-muted-foreground">
            Private is the default. Sharing is something you choose, record by record.
          </p>
        }
        title="Who can see it"
        titleId="sharing-title"
      >
        <TermList
          items={[
            {
              term: "Your private notes",
              detail: "Never visible to anyone else in your household, including its owners.",
            },
            {
              term: "Your household",
              detail:
                "Sees only what you put in the household or share with them. If you leave, your private notes leave with you.",
            },
            {
              term: "Eve",
              detail:
                "Reads only within the scopes you set, the same boundaries the rest of Tendnote follows.",
            },
            {
              term: "The person who runs it",
              detail:
                "Does not browse your notes. Like any hosted service, Tendnote's database is reachable by its operator, so your notes are opened only when you ask for help that needs it or an incident requires it, and any change made to an account by hand is recorded.",
            },
            {
              term: "Anyone outside",
              detail:
                "Nothing leaves Tendnote without your approval. A draft email or a message waits for you every time, with no setting that turns that off.",
            },
            {
              term: "Advertisers",
              detail:
                "No one. Your notes are never sold and never used for ads. Billing records hold none of your notes.",
            },
          ]}
        />
      </SplitSection>

      <SplitSection
        aside={
          <p className="max-w-[44ch] text-muted-foreground">
            The intelligence works for you and keeps nothing for itself.
          </p>
        }
        className="bg-surface"
        title="How AI is used"
        titleId="ai-title"
      >
        <p className="max-w-[62ch]">
          Eve and the background work that suggests Memories use models from Google and OpenAI,
          reached through Vercel&rsquo;s AI Gateway. Every call asks the gateway for zero data
          retention and no training, and each model is pinned to one provider, so your notes are not
          quietly rerouted somewhere else.
        </p>
        <p className="max-w-[62ch]">
          Your notes are never used to train a model. A model only proposes; you confirm. When you
          go over your monthly allowance, Eve tells you it is using a lighter model rather than
          switching silently.
        </p>
        <p className="max-w-[62ch] text-muted-foreground">
          Google Contacts, Calendar, and Gmail drafts are connected only if you connect them, and
          Tendnote keeps the minimum it needs from them.{" "}
          <Link className={inlineLink} href="/privacy#sub-processors">
            Every service that handles your data
          </Link>
        </p>
      </SplitSection>

      <SplitSection
        aside={
          <p className="max-w-[44ch] text-muted-foreground">
            Leaving is self-service and takes effect at once.
          </p>
        }
        title="Export and deletion"
        titleId="exit-title"
      >
        <p className="max-w-[62ch]">
          Export everything you keep, at any time, from your Account page. Delete your account from
          the same screen, with no waiting period and no requirement to export first. Your account
          closes immediately and its content is removed from the live service within minutes.
        </p>
        <ul className="flex max-w-[62ch] flex-col gap-2 pl-5 [list-style:disc] marker:text-primary">
          <li>Your private records and connections are deleted now.</li>
          <li>Records that belong to a shared household stay with that household.</li>
          <li>Your name is removed from the household&rsquo;s shared history.</li>
          <li>
            Residual copies of deleted content expire from backups within seven days, and a restore
            never brings a deleted account back.
          </li>
        </ul>
        <p className="max-w-[62ch] text-muted-foreground">
          If a subscription lapses, your content is kept for 90 days so you can come back, then
          deleted.{" "}
          <Link className={inlineLink} href="/privacy#retention">
            How long everything is kept
          </Link>
        </p>
        {recoveryCurrent ? (
          <p className={`max-w-[62ch] text-muted-foreground ${smallText}`}>{RECOVERY_SENTENCE}</p>
        ) : null}
      </SplitSection>

      {/*
       * True as of launch planning. Anonymous page counters (#646), account
       * funnel events with their opt-out (#640), and error reports once
       * GlitchTip is enabled (#655) each revise this section when they ship,
       * inside the same no-cookie, no-cross-site boundary.
       */}
      <SplitSection
        aside={<p className="max-w-[44ch] text-muted-foreground">On this site and in the app.</p>}
        className="bg-surface"
        title="No tracking"
        titleId="tracking-title"
      >
        <p className="max-w-[62ch]">
          There is no advertising, no cross-site tracking, no session replay, and no analytics
          cookie, which is why there is no cookie banner. Today this site sets no cookies and
          records nothing about your visit.
        </p>
      </SplitSection>

      <Section className="bg-panel" labelledBy="privacy-close-title">
        <div className="flex flex-col items-start gap-5">
          <h2 className={sectionTitle} id="privacy-close-title">
            The formal version
          </h2>
          <p className="max-w-[56ch] text-muted-foreground">
            The Privacy Policy states all of this precisely, with the retention table and the list
            of services that handle your data. Questions go to{" "}
            <a className={inlineLink} href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
          <Button asChild size="lg">
            <Link href="/privacy">Read the Privacy Policy</Link>
          </Button>
        </div>
      </Section>
    </>
  );
}
