// @vitest-environment jsdom

import { contextFactImportProviders } from "@tendnote/domain/context-fact-import";
import { describe, expect, it } from "vitest";
import { render } from "@/test/dom";
import { AssistantProviderMark } from "./assistant-provider-marks";

describe("AssistantProviderMark", () => {
  // The provider catalog is the source of truth. Adding a fourth assistant there
  // without drawing its mark would otherwise ship an invisible button.
  it.each(
    contextFactImportProviders.map((provider) => provider.id),
  )("draws a mark for %s", (providerId) => {
    const { container } = render(<AssistantProviderMark provider={providerId} />);

    const path = container.querySelector("svg > path");
    expect(path?.getAttribute("d")).toMatch(/^[Mm]/);
  });

  it("stays decorative, because the provider name is always beside it", () => {
    const { container } = render(<AssistantProviderMark provider="chatgpt" />);

    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});
