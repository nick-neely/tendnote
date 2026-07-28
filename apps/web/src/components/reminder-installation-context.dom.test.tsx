// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test/dom";

import {
  ReminderInstallationProvider,
  useReminderInstallation,
} from "./reminder-installation-context";

function Consumer() {
  const installation = useReminderInstallation();
  return (
    <output>
      {installation
        ? `${installation.clientInstallationId}|${installation.timeZone}`
        : "unresolved"}
    </output>
  );
}

describe("ReminderInstallationProvider", () => {
  it("does not mint an installation identity during render", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    expect(
      renderToStaticMarkup(
        <ReminderInstallationProvider>
          <Consumer />
        </ReminderInstallationProvider>,
      ),
    ).toContain("unresolved");
    expect(getItem).not.toHaveBeenCalled();
    getItem.mockRestore();
  });

  it("provides one shell-owned installation identity after mount", async () => {
    localStorage.clear();
    render(
      <ReminderInstallationProvider>
        <Consumer />
        <Consumer />
      </ReminderInstallationProvider>,
    );

    const values = screen.getAllByText(/\|/).map((node) => node.textContent);
    expect(values[0]).toBe(values[1]);
    expect(localStorage.getItem("tendnote.reminder-installation-id")).toBeTruthy();
  });

  it("accepts an injected value without reading browser storage", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    render(
      <ReminderInstallationProvider
        value={{ clientInstallationId: "browser-installation-1", timeZone: "America/Chicago" }}
      >
        <Consumer />
      </ReminderInstallationProvider>,
      { wrapper: ({ children }) => <>{children}</> },
    );
    expect(screen.getByText("browser-installation-1|America/Chicago")).toBeTruthy();
    expect(getItem).not.toHaveBeenCalled();
    getItem.mockRestore();
  });
});
