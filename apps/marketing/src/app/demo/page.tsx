import { Button } from "@tendnote/ui/button";
import type { Metadata } from "next";
import Link from "next/link";
import { DemoStory } from "@/components/demo/demo-story";
import { inlineLink, Section, sectionTitle } from "@/components/page-section";

export const metadata: Metadata = {
  title: "Demo",
  description:
    "Play one friend's job interview through Tendnote: write it down, keep the Memory, pick a day to check in, ask about it, and get the reminder. No account needed.",
};

/** What the plan includes beyond the five steps above, each one a real product surface. */
const beyondTheDemo = [
  {
    term: "Drafts in your voice",
    detail:
      "Ask Eve to draft the message to Sam. It waits for you: nothing leaves Tendnote without your approval.",
  },
  {
    term: "Birthdays and gifts",
    detail:
      "Set a birthday reminder for the day or a week before, and keep gift ideas and plans with the person, surprises included.",
  },
  {
    term: "A page for each person",
    detail:
      "Everything you have kept about someone in one place: their Memories, your follow-ups, and what is coming up.",
  },
  {
    term: "The Daily Brief",
    detail: "A short brief each day of the few people worth a thought today, never a backlog.",
  },
  {
    term: "Actions, routines, and things you own",
    detail:
      "Renew the passport, replace the water filter, keep the car's details. Write them like a note and they land in the right place.",
  },
  {
    term: "A shared household",
    detail:
      "Events, plans, and the things you own together with the people you live with. What you keep private stays private.",
  },
  {
    term: "Yours to take or delete",
    detail:
      "Export everything you keep at any time, and delete your account yourself from your Account page.",
  },
  {
    term: "Your own connections",
    detail:
      "Bring in Google Contacts and Calendar, or let Eve prepare a Gmail draft, if and when you want to.",
  },
];

export default function DemoPage() {
  return (
    <>
      <DemoStory />

      <Section className="bg-surface" labelledBy="beyond-title">
        <div className="flex flex-col gap-10">
          <div className="flex flex-col gap-3">
            <h2 className={sectionTitle} id="beyond-title">
              What the demo does not show
            </h2>
            <p className="max-w-[56ch] text-muted-foreground">
              Five steps cover the loop. The same notebook, and the same one plan, also carry all of
              this.
            </p>
          </div>
          <dl className="grid gap-x-12 border-t sm:grid-cols-2">
            {beyondTheDemo.map((item) => (
              <div className="flex flex-col gap-1.5 border-b py-5" key={item.term}>
                <dt className="font-semibold">{item.term}</dt>
                <dd className="max-w-[52ch] text-muted-foreground">{item.detail}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Button asChild size="lg">
              <Link href="/pricing">View pricing</Link>
            </Button>
            <Link className={inlineLink} href="/product">
              See the whole product
            </Link>
          </div>
        </div>
      </Section>
    </>
  );
}
