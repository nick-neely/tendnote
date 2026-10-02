import { Button } from "@tendnote/ui/button";
import type { Metadata } from "next";
import Link from "next/link";
import { DemoStory } from "@/components/demo/demo-story";
import { inlineLink, SplitSection, TermList } from "@/components/page-section";

export const metadata: Metadata = {
  title: "Demo",
  description:
    "Follow one fictional friend's job interview through Tendnote: write it down, keep the Memory, pick a day to check in, ask about it, and get the reminder. Scripted, with no account.",
};

const limits = [
  {
    term: "Scripted, not live",
    detail:
      "Every reply above was written in advance, and no model ran. In Tendnote, Eve answers from your own notes and shows the note each answer came from, so you can check it.",
  },
  {
    term: "Nothing saved or sent",
    detail:
      "There is no account behind the demo. Send, Approve, and Accept change nothing anywhere, and no reminder is scheduled.",
  },
  {
    term: "Sam stays here",
    detail:
      "Nothing from this story carries into a subscription. Your Tendnote starts with your own people and your own first note.",
  },
  {
    term: "A preview, not a promise",
    detail:
      "It shows how the loop works. It cannot show how Eve handles your notes or how reminders behave on your devices. That is what the fourteen-day refund is for.",
  },
];

export default function DemoPage() {
  return (
    <>
      <DemoStory />

      <SplitSection
        aside={
          <p className="max-w-[44ch] text-muted-foreground">
            A demo should be honest about what it can prove. This one shows the workflow, with
            nothing real underneath it.
          </p>
        }
        className="bg-surface"
        title="What this preview shows, and what it does not"
        titleId="limits-title"
      >
        <TermList items={limits} />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-4">
          <Button asChild size="lg">
            <Link href="/pricing">View pricing</Link>
          </Button>
          <Link className={inlineLink} href="/product">
            See the whole product
          </Link>
        </div>
      </SplitSection>
    </>
  );
}
