import { Button } from "@tendnote/ui/button";
import type { Metadata } from "next";
import Link from "next/link";
import {
  inlineLink,
  PageHeader,
  Section,
  sectionTitle,
  smallText,
  TermList,
} from "@/components/page-section";

export const metadata: Metadata = {
  title: "Product",
  description:
    "Capture what people tell you, confirm what is worth keeping, choose when to check in, and ask Eve for anything you wrote down.",
};

type Step = {
  id: string;
  title: string;
  body: React.ReactNode;
  sample: { label: string; text: string; meta?: string };
};

const steps: readonly Step[] = [
  {
    id: "capture",
    title: "Write it the way you would say it",
    body: "One sentence after a coffee or a call is enough. No form, no fields, no tagging. Tendnote works out who it is about.",
    sample: {
      label: "Your note",
      text: "Coffee with Sam. Final-round interview at a design studio on Thursday. Nervous about the portfolio review.",
    },
  },
  {
    id: "memory",
    title: "Keep what is worth keeping",
    body: "Tendnote suggests a Memory and attaches it to the person. It is saved when you confirm it, and not before. Dismiss anything that is not worth remembering.",
    sample: {
      label: "Suggested Memory · Sam Rivera",
      text: "Interviewing at a design studio, final round on Thursday. Nervous about the portfolio review.",
    },
  },
  {
    id: "followup",
    title: "Choose when to check in",
    body: "Set a follow-up for the day it will matter, with a reason you will recognize later. Tendnote suggests a date; you pick it.",
    sample: {
      label: "Follow-up · Friday",
      text: "Ask Sam how the interview went",
    },
  },
  {
    id: "resurface",
    title: "See it come back on the day",
    body: "On Friday it is on Today and in your Daily Brief, as one of a few things worth doing, never a backlog. A reminder can reach your phone if you turn reminders on.",
    sample: {
      label: "Today",
      text: "Ask Sam how the interview went",
      meta: "Friday, 9:00 AM",
    },
  },
  {
    id: "ask",
    title: "Ask Eve, and see where the answer came from",
    body: "Ask in plain words. Eve answers from what you wrote and shows the note beside the answer, so you can tell recall from guesswork.",
    sample: {
      label: "Eve",
      text: "The portfolio review. Sam's final round was Thursday, so today is a good day to ask how it went.",
      meta: "From your note · Tuesday",
    },
  },
];

export default function ProductPage() {
  return (
    <>
      <PageHeader
        lede="Tendnote is a private notebook for the people in your life. You tell it what they told you, and it hands the right thing back on the day it matters. Here is the everyday loop, one step at a time."
        title="Tell it once. It remembers for you."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link href="/demo">Explore the demo</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/pricing">View pricing</Link>
          </Button>
        </div>
      </PageHeader>

      <Section className="bg-surface" labelledBy="loop-title">
        <div className="flex flex-col gap-12">
          <div className="flex flex-col gap-3">
            <h2 className={sectionTitle} id="loop-title">
              One friend, one week
            </h2>
            <p className={`text-muted-foreground ${smallText}`}>
              Sam is fictional, and every detail here is invented.
            </p>
          </div>
          <ol className="flex flex-col divide-y border-y">
            {steps.map((step) => (
              <li
                className="grid gap-6 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-20"
                id={step.id}
                key={step.id}
              >
                <div className="flex flex-col gap-3">
                  <h3 className="text-[length:var(--text-h2)] leading-[var(--text-h2-line)] font-semibold">
                    {step.title}
                  </h3>
                  <p className="max-w-[52ch] text-muted-foreground">{step.body}</p>
                </div>
                <figure className="flex flex-col gap-2 self-start rounded-xl border bg-background px-4 py-3.5">
                  <figcaption className="flex items-center justify-between gap-3 text-[length:var(--text-caption)] leading-[var(--text-caption-line)] font-medium text-muted-foreground">
                    <span>{step.sample.label}</span>
                    {step.sample.meta ? (
                      <span className="font-mono">{step.sample.meta}</span>
                    ) : null}
                  </figcaption>
                  <p className={smallText}>{step.sample.text}</p>
                </figure>
              </li>
            ))}
          </ol>
          <p className="max-w-[62ch] text-muted-foreground">
            Everything you capture and everything Eve reads stays inside the boundaries you set, and
            nothing leaves Tendnote without your approval.{" "}
            <Link className={inlineLink} href="/privacy-and-ai">
              How Tendnote handles your information
            </Link>
          </p>
        </div>
      </Section>

      <Section labelledBy="more-title">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-20">
          <div className="flex flex-col gap-4">
            <h2 className={sectionTitle} id="more-title">
              The rest of life, in the same notebook
            </h2>
            <p className="max-w-[44ch] text-muted-foreground">
              People are where Tendnote starts. Once you are using it, the same capture and the same
              Eve keep the rest of your life admin too, at no extra cost.
            </p>
          </div>
          <TermList
            items={[
              {
                term: "Actions",
                detail:
                  "One-off things that are not about a person: renew the passport, book the car in. Write them like a note and they land in the right place.",
              },
              {
                term: "Routines",
                detail:
                  "The things that come round again, like replacing the water filter, on the cadence you set.",
              },
              {
                term: "Assets",
                detail:
                  "The things you own and look after, such as an appliance, a car, or a subscription, with what you know about each.",
              },
              {
                term: "Household",
                detail: (
                  <>
                    Share a household with the people you live with: events, plans, and the things
                    you own together. What you keep private stays private.{" "}
                    <Link className={inlineLink} href="/pricing#household">
                      How households are billed
                    </Link>
                  </>
                ),
              },
              {
                term: "Connections",
                detail:
                  "Bring in Google Contacts and Calendar, or let Eve prepare a Gmail draft for you to send, if and when you want to. None of it is needed to get started.",
              },
            ]}
          />
        </div>
      </Section>

      <Section className="bg-panel" labelledBy="product-close-title">
        <div className="flex flex-col items-start gap-5">
          <h2 className={sectionTitle} id="product-close-title">
            See Sam&rsquo;s week for yourself
          </h2>
          <p className="max-w-[56ch] text-muted-foreground">
            The demo walks through the whole loop with a fictional friend. It needs no account and
            asks for nothing about you.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/demo">Explore the demo</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/pricing">View pricing</Link>
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
