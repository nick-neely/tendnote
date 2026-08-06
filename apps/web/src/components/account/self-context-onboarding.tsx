"use client";

import type { ContextFactView } from "@tendnote/domain";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { SelfContextFactActionInput } from "@/app/actions/context-facts";
import {
  completeSelfContextOnboardingAction,
  createOnboardingSelfContextFactAction,
  dismissSelfContextOnboardingAction,
  type SelfContextOnboardingActionResult,
} from "@/app/actions/context-onboarding";
import {
  ContextFactEditor,
  type ContextFactEditorCategoryOption,
} from "@/components/account/about-you-surface";
import { ContextFactImportInvitation } from "@/components/account/context-fact-import-invitation";
import { appDestination } from "@/components/app-destinations";
import { Button } from "@/components/ui/button";
import {
  isActiveSelfContextFact,
  type SelfContextCategory,
  type SelfContextFactMutationResult,
  type SelfContextFactMutationView,
} from "@/lib/context-fact-view";

type CreateAction = (input: SelfContextFactActionInput) => Promise<SelfContextFactMutationResult>;
type OnboardingAction = () => Promise<SelfContextOnboardingActionResult>;

const WORK_OR_BACKGROUND: readonly ContextFactEditorCategoryOption[] = [
  { value: "work", label: "Work" },
  { value: "background", label: "Background" },
];
const PREFERENCE_OR_CONSTRAINT: readonly ContextFactEditorCategoryOption[] = [
  { value: "preference", label: "Preference" },
  { value: "constraint", label: "Constraint" },
];

type OnboardingPrompt = {
  id: string;
  title: string;
  description: string;
  categoryOptions: readonly ContextFactEditorCategoryOption[];
  initialCategory: SelfContextCategory;
  placeholder: string;
  helperText: string;
};

const ONBOARDING_PROMPTS: readonly OnboardingPrompt[] = [
  {
    id: "work-background",
    title: "What should Eve know about your work or background?",
    description: "A short orienting fact is enough. You can choose Work or Background.",
    categoryOptions: WORK_OR_BACKGROUND,
    initialCategory: "work",
    placeholder: "For example: I run a software consultancy.",
    helperText: "Private to you",
  },
  {
    id: "location",
    title: "Where are you generally based?",
    description: "Share a city, region, or time zone — never a street address.",
    categoryOptions: [{ value: "location", label: "Location" }],
    initialCategory: "location",
    placeholder: "For example: I am based in Chicago.",
    helperText: "General area only · private to you",
  },
  {
    id: "interest",
    title: "What are you interested in?",
    description: "A durable interest can help Eve make relevant suggestions without guessing.",
    categoryOptions: [{ value: "interest", label: "Interest" }],
    initialCategory: "interest",
    placeholder: "For example: I am interested in trail running and local history.",
    helperText: "Private to you",
  },
  {
    id: "preference-constraint",
    title: "Any durable preference or constraint?",
    description: "Choose Preference or Constraint, and skip this if nothing comes to mind.",
    categoryOptions: PREFERENCE_OR_CONSTRAINT,
    initialCategory: "preference",
    placeholder: "For example: I prefer concise answers.",
    helperText: "Private to you",
  },
];

function promptHasFact(prompt: OnboardingPrompt, facts: ContextFactView[]): boolean {
  return facts.some(
    (fact) =>
      isActiveSelfContextFact(fact) &&
      prompt.categoryOptions.some((option) => option.value === fact.category),
  );
}

function firstUnansweredPrompt(facts: ContextFactView[]): number {
  const index = ONBOARDING_PROMPTS.findIndex((prompt) => !promptHasFact(prompt, facts));
  return index === -1 ? ONBOARDING_PROMPTS.length : index;
}

export type SelfContextOnboardingProps = {
  initialFacts: ContextFactView[];
  createAction?: CreateAction;
  completeAction?: OnboardingAction;
  dismissAction?: OnboardingAction;
};

export function SelfContextOnboarding({
  initialFacts,
  createAction = createOnboardingSelfContextFactAction,
  completeAction = completeSelfContextOnboardingAction,
  dismissAction = dismissSelfContextOnboardingAction,
}: SelfContextOnboardingProps) {
  const router = useRouter();
  const [facts, setFacts] = useState(() => initialFacts.filter(isActiveSelfContextFact));
  const [promptIndex, setPromptIndex] = useState(() => firstUnansweredPrompt(initialFacts));
  const [pendingAction, setPendingAction] = useState<"complete" | "dismiss" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const prompt = ONBOARDING_PROMPTS[promptIndex];
  const completedCount = useMemo(
    () => ONBOARDING_PROMPTS.filter((candidate) => promptHasFact(candidate, facts)).length,
    [facts],
  );

  function addFact(view: ContextFactView) {
    setFacts((current) => {
      const index = current.findIndex((fact) => fact.id === view.id);
      if (index === -1) return [...current, view];
      const next = [...current];
      next[index] = view;
      return next;
    });
  }

  function advance(promptTitle: string) {
    setPromptIndex((current) => Math.min(current + 1, ONBOARDING_PROMPTS.length));
    setAnnouncement(`${promptTitle} skipped.`);
    setActionError(null);
  }

  function handleSaved(result: SelfContextFactMutationView) {
    addFact(result.fact);
    setPromptIndex((current) => Math.min(current + 1, ONBOARDING_PROMPTS.length));
    setAnnouncement(
      result.decision === "existing"
        ? "That fact is already saved. Continuing setup."
        : "Fact saved.",
    );
    setActionError(null);
  }

  async function finish(action: OnboardingAction, kind: "complete" | "dismiss") {
    if (pendingAction) return;
    setPendingAction(kind);
    setActionError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      setAnnouncement(kind === "complete" ? "Self Context setup complete." : "Setup skipped.");
      setPromptIndex(ONBOARDING_PROMPTS.length);
      const homeRoute = appDestination("today").route;
      router.push(kind === "dismiss" ? `${homeRoute}?selfContext=skipped` : homeRoute);
      router.refresh();
    } catch {
      setActionError("We couldn't save your setup choice. Your answers are still here. Try again.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section
      aria-labelledby="self-context-onboarding-heading"
      className="mx-auto flex min-w-0 w-full max-w-2xl flex-col gap-6"
      data-self-context-onboarding
    >
      <header className="flex min-w-0 flex-col gap-2">
        <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground">
          Optional setup · {completedCount} of {ONBOARDING_PROMPTS.length} saved
        </p>
        <h1
          className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold"
          id="self-context-onboarding-heading"
        >
          Help Eve understand you
        </h1>
        <p className="max-w-[65ch] break-words text-[length:var(--text-body)] leading-[var(--text-body-line)] text-muted-foreground">
          Share a few small, private facts if you want. Every question is optional, and you can
          finish with no answers.
        </p>
      </header>

      {/* Offered before the prompts, not after: an owner who already keeps this
          context in another assistant should not have to type it out first. It
          stays an alternative, never a step, so setup is still four optional
          questions and nothing more. */}
      <ContextFactImportInvitation from="onboarding" id="onboarding-import" />

      {announcement ? (
        <p
          aria-live="polite"
          className="text-[length:var(--text-small)] text-muted-foreground"
          role="status"
        >
          {announcement}
        </p>
      ) : null}
      {actionError ? (
        <p className="text-[length:var(--text-small)] text-destructive" role="alert">
          {actionError}
        </p>
      ) : null}

      {prompt ? (
        <ContextFactEditor
          categoryOptions={prompt.categoryOptions}
          createAction={createAction}
          editor={{ mode: "create" }}
          heading={prompt.title}
          helperText={prompt.helperText}
          initialCategory={prompt.initialCategory}
          key={prompt.id}
          onCancel={() => advance(prompt.title)}
          onSaved={handleSaved}
          placeholder={prompt.placeholder}
          description={prompt.description}
          submitLabel="Save and continue"
          cancelLabel="Skip this question"
        />
      ) : (
        <section
          aria-labelledby="self-context-onboarding-finished-heading"
          className="flex flex-col gap-3 rounded-xl border bg-surface px-4 py-5"
        >
          <h2
            className="text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium"
            id="self-context-onboarding-finished-heading"
          >
            You&rsquo;re in control
          </h2>
          <p className="break-words text-[length:var(--text-body)] leading-[var(--text-body-line)] text-muted-foreground">
            Your saved facts are private and independently editable in Account → About you. Eve
            treats them as untrusted context, not instructions.
          </p>
          <Button
            className="min-h-11 w-full sm:w-fit"
            disabled={pendingAction !== null}
            onClick={() => void finish(completeAction, "complete")}
            type="button"
          >
            {pendingAction === "complete" ? "Finishing…" : "Finish setup"}
          </Button>
        </section>
      )}

      <div className="flex min-w-0 flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Button
          className="min-h-11 w-full sm:w-auto"
          disabled={pendingAction !== null}
          onClick={() => void finish(dismissAction, "dismiss")}
          type="button"
          variant="ghost"
        >
          {pendingAction === "dismiss" ? "Skipping…" : "Skip entire setup"}
        </Button>
        {prompt ? (
          <Button
            className="min-h-11 w-full sm:w-auto"
            disabled={pendingAction !== null}
            onClick={() => void finish(completeAction, "complete")}
            type="button"
            variant="outline"
          >
            Finish setup
          </Button>
        ) : null}
      </div>
    </section>
  );
}
