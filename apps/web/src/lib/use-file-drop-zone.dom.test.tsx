// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { type FileDrop, useFileDropZone } from "@/lib/use-file-drop-zone";
import { act, renderHook } from "@/test/dom";

/**
 * The three things a drop target has to get right before anything downstream of
 * it matters: it must not flicker while the pointer crosses the elements inside
 * it, it must ignore drags that carry no files, and it must hand the drop on
 * exactly once — to its own caller and to nobody else's listener.
 *
 * jsdom implements neither `DragEvent` nor `DataTransfer`, so the events here
 * are plain `Event`s with the two fields the hook actually reads. That is the
 * honest surface: everything the hook decides, it decides from `types` and
 * `files`.
 */

const PNG = "image/png";

function file(name: string, type: string): File {
  return new File([new Uint8Array(4)], name, { type });
}

function dragEvent(
  type: string,
  { files = [], types = ["Files"] }: { files?: File[]; types?: string[] } = {},
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { dropEffect: "none", files, types },
  });
  return event;
}

let zones: HTMLElement[] = [];

afterEach(() => {
  for (const zone of zones) {
    zone.remove();
  }
  zones = [];
});

function mountZone(accept: string[] = [PNG, "application/pdf"]) {
  const zone = document.createElement("div");
  const child = document.createElement("button");
  zone.append(child);
  document.body.append(zone);
  zones.push(zone);

  const onFiles = vi.fn<(drop: FileDrop) => void>();
  const view = renderHook(() => useFileDropZone({ current: zone }, { accept, onFiles }));
  const send = (event: Event, target: HTMLElement = zone) => {
    act(() => {
      target.dispatchEvent(event);
    });
  };
  return { child, dragging: () => view.result.current, onFiles, send, zone };
}

it("stays lit while the pointer crosses into a child, and goes out only on the last leave", () => {
  const { child, dragging, send, zone } = mountZone();

  send(dragEvent("dragenter"));
  expect(dragging()).toBe(true);

  // Entering a child fires an enter for the child *and* a leave for the zone.
  // A flat boolean would go dark here, over every message and button inside.
  send(dragEvent("dragenter"), child);
  send(dragEvent("dragleave"));
  expect(dragging()).toBe(true);

  send(dragEvent("dragleave"), child);
  expect(dragging()).toBe(false);

  // The count is back to zero, so the next drag lights the zone on its first enter.
  send(dragEvent("dragenter"), zone);
  expect(dragging()).toBe(true);
});

it("ignores a drag that carries text or a link rather than files", () => {
  const { dragging, onFiles, send } = mountZone();

  send(dragEvent("dragenter", { types: ["text/plain", "text/uri-list"] }));
  expect(dragging()).toBe(false);

  send(dragEvent("drop", { types: ["text/plain"] }));
  expect(onFiles).not.toHaveBeenCalled();
});

it("splits the drop by the accepted types, keeping the order they arrived in", () => {
  const { onFiles, send } = mountZone();
  const receipt = file("receipt.png", PNG);
  const manual = file("manual.pdf", "application/pdf");
  const archive = file("photos.zip", "application/zip");

  send(dragEvent("dragenter"));
  send(dragEvent("drop", { files: [archive, receipt, manual] }));

  expect(onFiles).toHaveBeenCalledWith({
    accepted: [receipt, manual],
    rejected: [archive],
  });
});

it("matches a `type/*` wildcard the way a file input's own accept does", () => {
  const { onFiles, send } = mountZone(["image/*"]);
  const receipt = file("receipt.png", PNG);
  const manual = file("manual.pdf", "application/pdf");

  send(dragEvent("drop", { files: [receipt, manual] }));

  expect(onFiles).toHaveBeenCalledWith({ accepted: [receipt], rejected: [manual] });
});

it("takes the drop off the page: nothing bubbles past the zone", () => {
  const { onFiles, send, zone } = mountZone();
  // Stands in for `PromptInput`'s own form-level drop listener, which would put
  // the file into its attachment store — the one place ADR 0185 says an
  // evidence file must never reach.
  const bubbled = vi.fn();
  zone.addEventListener("drop", bubbled);
  const dropped = dragEvent("drop", { files: [file("receipt.png", PNG)] });

  send(dropped);

  expect(onFiles).toHaveBeenCalledOnce();
  expect(bubbled).not.toHaveBeenCalled();
  expect(dropped.defaultPrevented).toBe(true);
});

it("lets the overlay go on Escape without waiting for the drag to end", () => {
  const { dragging, send } = mountZone();

  send(dragEvent("dragenter"));
  expect(dragging()).toBe(true);

  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  expect(dragging()).toBe(false);
});

it("goes dark on a drop that turns out to carry nothing", () => {
  const { dragging, onFiles, send } = mountZone();

  send(dragEvent("dragenter"));
  send(dragEvent("drop", { files: [] }));

  expect(dragging()).toBe(false);
  expect(onFiles).not.toHaveBeenCalled();
});
