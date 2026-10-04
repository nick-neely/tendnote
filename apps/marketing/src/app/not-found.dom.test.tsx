// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NotFound from "./not-found";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("NotFound", () => {
  it("links an unknown path to the app", () => {
    vi.stubEnv("TENDNOTE_APP_ORIGIN", "https://preview.example.com");
    render(<NotFound />);
    expect(screen.getByRole("link", { name: "Open the app" }).getAttribute("href")).toBe(
      "https://preview.example.com",
    );
  });
});
