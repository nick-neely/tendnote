import { Button } from "@tendnote/ui/button";
import Link from "next/link";
import { LoopHero } from "@/components/home/loop-hero";
import { ReminderMoment } from "@/components/home/reminder-moment";
import { appLinks } from "@/lib/site-links";

const sectionTitle =
  "text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold sm:text-[1.75rem] sm:leading-9";
const inlineLink =
  "rounded-sm font-medium text-foreground underline underline-offset-4 outline-none transition-colors duration-150 hover:text-primary focus-visible:ring-3 focus-visible:ring-ring";

const promises = [
  {
    title: "Nothing leaves without you",
    body: "A draft or a message to anyone outside Tendnote waits for your approval. Every time, with no setting that turns it off.",
  },
  {
    title: "Your notes are yours",
    body: "Never sold, never used for ads, never used to train a model. Billing records hold none of your notes.",
  },
  {
    title: "Open source, all of it",
    body: "Read the code that holds your notes, or run it yourself for free under the AGPL-3.0.",
  },
];

const habits = [
  "One to three follow-ups a day, never a backlog.",
  "Capture in a sentence. Tendnote finds the person and the Memory.",
  "Ask in plain words. The answer cites the note it came from.",
];

function Section({
  children,
  className = "",
  labelledBy,
}: {
  children: React.ReactNode;
  className?: string;
  labelledBy: string;
}) {
  return (
    <section aria-labelledby={labelledBy} className={`border-t ${className}`}>
      <div className="mx-auto max-w-6xl px-gutter py-16 sm:px-6 sm:py-24">{children}</div>
    </section>
  );
}

export default function HomePage() {
  const { subscribe } = appLinks();

  return (
    <>
      <LoopHero />

      <Section labelledBy="why-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-20">
          <div className="flex flex-col gap-5">
            <h2
              className="font-display text-[2rem] leading-[1.15] font-semibold sm:text-[2.5rem]"
              id="why-title"
            >
              Caring was never the problem. Remembering was.
            </h2>
            <p className="max-w-[54ch] text-lg leading-7 text-muted-foreground">
              You meant to ask how it went. Then a week passed, and it felt too late to bring up.
              Not because you did not care, but because your head is a busy place to keep the lives
              of everyone you love.
            </p>
            <p className="max-w-[54ch] text-lg leading-7 text-muted-foreground">
              Tendnote is the notebook that holds it for you and hands back one thing at a time, on
              the day it matters. No streaks, no scores, and no guilt when you miss a day.
            </p>
          </div>
          <ul className="flex flex-col divide-y self-center border-y">
            {habits.map((habit) => (
              <li
                className="py-4 text-[length:var(--text-title)] leading-[var(--text-title-line)]"
                key={habit}
              >
                {habit}
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-12 max-w-[65ch] text-muted-foreground">
          People are where Tendnote starts, not where it stops. The same private notebook keeps your
          actions and routines, the things you own, and a household you share.{" "}
          <Link className={inlineLink} href="/product">
            See the whole product
          </Link>
        </p>
      </Section>

      <Section className="bg-surface" labelledBy="trust-title">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-20">
          <div className="flex flex-col gap-4">
            <h2 className={sectionTitle} id="trust-title">
              Built to be trusted with what people tell you in confidence
            </h2>
            <p className="max-w-[44ch] text-muted-foreground">
              Your relationships are not a data source for anyone else. These are not settings. They
              are how Tendnote is made.
            </p>
            <Link className={`${inlineLink} w-fit`} href="/privacy-and-ai">
              How Tendnote handles your information
            </Link>
          </div>
          <dl className="divide-y rounded-2xl border bg-background">
            {promises.map((promise) => (
              <div
                className="grid gap-2 px-5 py-5 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-6"
                key={promise.title}
              >
                <dt className="text-[length:var(--text-title)] leading-[var(--text-title-line)] font-semibold">
                  {promise.title}
                </dt>
                <dd className="text-muted-foreground">{promise.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>

      <Section labelledBy="maker-title">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-20">
          <h2 className={sectionTitle} id="maker-title">
            Made and run by one person
          </h2>
          <div className="flex flex-col gap-4 text-lg leading-7">
            <p>
              I&rsquo;m Nick. I built Tendnote for my own friends and family first, and I use it
              myself. There are no investors to please, no ads to sell, and one plan.
            </p>
            <p className="text-muted-foreground">
              That also means there is no logo wall on this page. What there is: the source code in
              the open, a written account of how it was built, and a full refund within fourteen
              days if it is not for you.
            </p>
            <p className="flex flex-wrap gap-x-6 gap-y-2 text-[length:var(--text-small)] leading-[var(--text-small-line)]">
              <Link className={inlineLink} href="/about">
                About Tendnote
              </Link>
              <a
                className={inlineLink}
                href="https://github.com/nick-neely/tendnote/blob/00b2edcb11be862f747a96851eb66b71dcaefd7f/docs/case-studies/tendnote-agent-built-privacy.md"
              >
                Read the case study
              </a>
            </p>
          </div>
        </div>
      </Section>

      <Section className="bg-panel" labelledBy="plan-title">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-20">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <h2 className={sectionTitle} id="plan-title">
                One plan. Fourteen days to change your mind.
              </h2>
              <p className="max-w-[56ch] text-muted-foreground">
                $20 a month or $200 a year, plus applicable sales tax, for adults in the United
                States. Cancel any time and keep access to the end of the period. Ask for a full
                refund within fourteen days of your first payment.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <a href={subscribe}>Subscribe</a>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/pricing">View pricing</Link>
              </Button>
            </div>
            <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
              Outside the United States? Tendnote is free to{" "}
              <a
                className={inlineLink}
                href="https://github.com/nick-neely/tendnote/blob/main/docs/self-hosting/vercel-operator-runbook.md"
              >
                run yourself
              </a>
              .
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 lg:items-end">
            <ReminderMoment />
            <p className="max-w-sm text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground lg:text-right">
              This is what Friday looks like: one reminder, on the devices you chose, and nothing
              else in your inbox.
            </p>
          </div>
        </div>
      </Section>
    </>
  );
}
