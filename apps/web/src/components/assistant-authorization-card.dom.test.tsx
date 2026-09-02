// @vitest-environment jsdom
import type { EveAuthorizationPart } from "eve/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent } from "@/test/dom";
import { AssistantAuthorizationCard } from "./assistant-authorization-card";

/**
 * A turn that stops for a sign-in used to render as nothing at all, so the reply
 * simply looked broken. What this card owes the reader is therefore: say a turn
 * is waiting, say what on, and offer exactly the two things that move it — the
 * code and the link — without ever handing the browser a URL it should not
 * follow.
 */

function challenge(
  authorization: EveAuthorizationPart["authorization"],
  overrides: Partial<EveAuthorizationPart> = {},
): EveAuthorizationPart {
  return {
    authorization,
    description: "Sign in to read your calendar.",
    displayName: "Google Calendar",
    name: "google_calendar",
    state: "required",
    stepIndex: 0,
    turnId: "turn-1",
    type: "authorization",
    ...overrides,
  } as EveAuthorizationPart;
}

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a connection that needs signing in to", () => {
  it("names what is waiting and offers the sign-in link", () => {
    render(
      <AssistantAuthorizationCard
        isNew
        part={challenge({ url: "https://accounts.example.com/connect" })}
      />,
    );

    expect(screen.getByText("Google Calendar needs your sign-in")).toBeDefined();
    expect(screen.getByText("Sign in to read your calendar.")).toBeDefined();

    const link = screen.getByRole("link", { name: /Open sign-in/ });
    expect(link.getAttribute("href")).toBe("https://accounts.example.com/connect");
    // A third party never learns which page the reader was on.
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("copies the device code rather than making the reader retype it", async () => {
    render(
      <AssistantAuthorizationCard
        isNew
        part={challenge({ url: "https://accounts.example.com/connect", userCode: "ABCD-1234" })}
      />,
    );

    expect(screen.getByText("ABCD-1234")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Copy the code" }));

    expect(writeText).toHaveBeenCalledWith("ABCD-1234");
    expect(screen.getByRole("button", { name: "Code copied" })).toBeDefined();
  });

  /**
   * The URL is eve's own connect endpoint today. "Today" is exactly the
   * assumption a connector added later breaks, and the cost of being wrong is a
   * `javascript:` URL behind a button captioned "Open sign-in".
   */
  it.each([
    ["javascript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["http://accounts.example.com/connect"],
    ["not a url at all"],
  ])("refuses to link %s, and shows it as plain text instead", (url) => {
    render(<AssistantAuthorizationCard isNew part={challenge({ url })} />);

    expect(screen.queryByRole("link", { name: /Open sign-in/ })).toBeNull();
    expect(screen.getByText(url)).toBeDefined();
  });

  it("says how long the code has left, and when it has none", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const { unmount } = render(
      <AssistantAuthorizationCard
        isNew
        part={challenge({
          expiresAt: "2026-01-01T00:04:00.000Z",
          url: "https://accounts.example.com/connect",
        })}
      />,
    );
    expect(screen.getByText("Expires in 4 minutes")).toBeDefined();
    unmount();

    render(
      <AssistantAuthorizationCard
        isNew
        part={challenge({
          expiresAt: "2025-12-31T23:59:00.000Z",
          url: "https://accounts.example.com/connect",
        })}
      />,
    );
    expect(screen.getByText("This code has expired")).toBeDefined();
  });

  it("says nothing about expiry when the stamp is missing or unreadable", () => {
    render(
      <AssistantAuthorizationCard
        isNew
        part={challenge({ expiresAt: "whenever", url: "https://accounts.example.com/connect" })}
      />,
    );

    expect(screen.queryByText(/Expires in/)).toBeNull();
    expect(screen.queryByText("This code has expired")).toBeNull();
  });
});

/** The settled half: the connection is made, and the turn has to be asked again. */
describe("a connection that is already made", () => {
  it("reports it as done and says what to do next", () => {
    render(
      <AssistantAuthorizationCard
        isNew={false}
        part={challenge(undefined, { state: "completed" })}
      />,
    );

    expect(screen.getByText("Google Calendar connected")).toBeDefined();
    expect(screen.getByText(/Ask again and the assistant can use it/)).toBeDefined();
    expect(screen.queryByRole("link", { name: /Open sign-in/ })).toBeNull();
  });

  it("falls back to the tool's own name when there is no display name", () => {
    render(
      <AssistantAuthorizationCard
        isNew={false}
        part={challenge(undefined, { displayName: undefined, state: "completed" })}
      />,
    );

    expect(screen.getByText("google_calendar connected")).toBeDefined();
  });
});
