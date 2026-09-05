import { expect, it } from "vitest";
import { activeToolLabel, completedToolLabel } from "./active-tool-label";
import { humanizeToolName, specialistToolName } from "./tool-name";

it.each([
  ["message_drafter", "Message drafter"],
  ["relationship_strategist", "Relationship strategist"],
  ["memory_curator", "Memory curator"],
  ["privacy_guard", "Privacy guard"],
  ["future_helper", "Future helper"],
])("recognizes runtime and legacy calls for %s", (role, label) => {
  for (const prefix of ["eve:subagent:", "subagent:"]) {
    const name = `${prefix}${role}`;
    expect(specialistToolName(name)).toBe(role);
    expect(activeToolLabel(name)).toBe(`${label} is helping…`);
    expect(completedToolLabel(name)).toBe(`${label} finished`);
    expect(humanizeToolName(name)).toBe(label.toLowerCase());
  }
});

it("preserves ordinary tools and framework skill names", () => {
  expect(specialistToolName("eve:load-skill")).toBeUndefined();
  expect(specialistToolName("update_person")).toBeUndefined();
  expect(humanizeToolName("eve:load-skill")).toBe("load skill");
  expect(humanizeToolName("update_person")).toBe("update person");
});
