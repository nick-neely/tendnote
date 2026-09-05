import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { activeToolLabel, completedToolLabel } from "@/lib/eve/active-tool-label";
import { specialistToolName } from "@/lib/eve/tool-name";
import { renderInBrowser } from "@/test/browser";
import { AssistantTurnActivity } from "./assistant-turn-activity";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => cleanup?.());

it.each([true, false])(
  "renders runtime specialist names and role icons (streaming=%s)",
  async (streaming) => {
    const roles = ["message_drafter", "relationship_strategist", "memory_curator", "privacy_guard"];
    const steps = roles.map((role) => {
      const toolName = `eve:subagent:${role}`;
      return {
        toolCallId: role,
        description: null,
        specialist: specialistToolName(toolName),
        label: streaming ? activeToolLabel(toolName) : completedToolLabel(toolName),
        status: streaming ? ("active" as const) : ("complete" as const),
      };
    });
    const rendered = await renderInBrowser(
      <AssistantTurnActivity
        durationSeconds={streaming ? null : 5}
        reasoning={null}
        steps={steps}
        streaming={streaming}
      />,
    );
    cleanup = rendered.unmount;
    const label = streaming ? "Message drafter is helping…" : "Message drafter finished";
    const toggle = page.getByRole("button");
    if (rendered.container.querySelector("button")?.getAttribute("aria-expanded") !== "true")
      await toggle.click();
    await expect.element(page.getByText(label, { exact: true }).first()).toBeVisible();
    const icons = rendered.container.querySelectorAll(".text-primary > div:first-child > svg");
    expect(icons).toHaveLength(4);
    expect(new Set(Array.from(icons, (icon) => icon.innerHTML)).size).toBe(4);
    expect(rendered.container.textContent).not.toContain("subagent:");
    expect(rendered.container.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
);
