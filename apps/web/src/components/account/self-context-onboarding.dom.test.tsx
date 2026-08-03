// @vitest-environment jsdom

import type { ContextFactView } from "@tendnote/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";

const router = { push: vi.fn(), refresh: vi.fn() };

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

vi.mock("@/app/actions/context-onboarding", () => ({
  completeSelfContextOnboardingAction: vi.fn(),
  createOnboardingSelfContextFactAction: vi.fn(),
  dismissSelfContextOnboardingAction: vi.fn(),
}));

vi.mock("@/app/actions/context-facts", () => ({
  archiveSelfContextFactAction: vi.fn(),
  createSelfContextFactAction: vi.fn(),
  deleteSelfContextFactAction: vi.fn(),
  restoreSelfContextFactAction: vi.fn(),
  updateSelfContextFactAction: vi.fn(),
}));

vi.mock("@/app/actions/context-fact-review", () => ({
  acceptSuggestedContextFactAction: vi.fn(),
  dismissSuggestedContextFactAction: vi.fn(),
}));

import { SelfContextOnboarding } from "./self-context-onboarding";

const NOW = new Date("2026-08-02T12:00:00.000Z");

function fact(category: ContextFactView["category"], content: string): ContextFactView {
  return {
    id: `00000000-0000-4000-8000-${category.padStart(12, "0")}`,
    subject: { kind: "self" },
    category,
    content,
    lifecycle: "active",
    sensitivity: "normal",
    provenance: { channel: "onboarding", origin: "direct" },
    reviewedAt: NOW,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    trust: "untrusted_data",
    authority: "none",
    visibility: "private",
  };
}

describe("SelfContextOnboarding", () => {
  beforeEach(() => {
    router.push.mockReset();
    router.refresh.mockReset();
  });

  it("saves a prompt, skips the remaining prompts, and completes", async () => {
    const user = userEvent.setup();
    const createAction = vi.fn(async () => ({
      ok: true as const,
      view: { fact: fact("work", "I run a consultancy."), decision: "created" as const },
    }));
    const completeAction = vi.fn(async () => ({
      ok: true as const,
      view: { status: "completed" as const, reminderAt: null },
    }));

    render(
      <SelfContextOnboarding
        completeAction={completeAction}
        createAction={createAction}
        initialFacts={[]}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: "Fact" }), "I run a consultancy.");
    await user.click(screen.getByRole("button", { name: "Save and continue" }));
    await user.click(screen.getByRole("button", { name: "Skip this question" }));
    await user.click(screen.getByRole("button", { name: "Skip this question" }));
    await user.click(screen.getByRole("button", { name: "Skip this question" }));
    expect(screen.getByRole("heading", { name: "You’re in control" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    await waitFor(() => expect(completeAction).toHaveBeenCalledOnce());
    expect(createAction).toHaveBeenCalledOnce();
    expect(router.push).toHaveBeenCalledWith("/");
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("keeps the prompt open when completion fails", async () => {
    const user = userEvent.setup();
    const completeAction = vi.fn(async () => ({
      ok: false as const,
      error: "Try again later.",
    }));

    render(<SelfContextOnboarding completeAction={completeAction} initialFacts={[]} />);

    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Try again later.");
    expect(screen.getByRole("heading", { name: "Help Eve understand you" })).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("resumes after an existing work fact and can skip the whole setup", async () => {
    const user = userEvent.setup();
    const dismissAction = vi.fn(async () => ({
      ok: true as const,
      view: { status: "dismissed" as const, reminderAt: null },
    }));

    render(
      <SelfContextOnboarding
        dismissAction={dismissAction}
        initialFacts={[fact("work", "I run a consultancy.")]}
      />,
    );

    expect(screen.getByRole("heading", { name: /Where are you generally based/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Skip entire setup" }));
    await waitFor(() => expect(dismissAction).toHaveBeenCalledOnce());
    expect(router.push).toHaveBeenCalledWith("/?selfContext=skipped");
  });
});
