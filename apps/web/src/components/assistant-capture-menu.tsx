"use client";

import { ASSET_EVIDENCE_ALLOWED_MIME_TYPES } from "@tendnote/domain";
import { useRef } from "react";
import {
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
} from "@/components/ai-elements/prompt-input";
import { CameraIcon, ImageIcon, PaperclipIcon, PlusIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * Every entry clears the 44px touch floor: "Take a photo" is the phone-only
 * path, so this menu is reached by thumb more than by mouse — the dropdown
 * default (~28px) is a mis-tap waiting to happen (DESIGN.md §8).
 */
const CAPTURE_ENTRY = "min-h-11 gap-2.5 px-3 text-[length:var(--text-small)]";

/**
 * The Eve composer's plus-menu (#201): three ways to pick Asset Evidence —
 * camera, photo library, file — one shared flow after (see
 * `assistant-evidence-capture.tsx`). The camera entry opens the device camera
 * directly and, like the shared drop zone's camera button, only offers itself
 * on small screens where a camera is in hand. Each entry drives a hidden native
 * input; the picked file is handed to the capture panel unopened — never into
 * the Eve turn.
 */
export function AssistantCaptureMenu({
  onPick,
  disabled,
}: {
  onPick: (file: File) => void;
  disabled?: boolean;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function takeFile(list: FileList | null) {
    const file = list?.[0];
    if (file) {
      onPick(file);
    }
  }

  const pickerProps = (ref: React.RefObject<HTMLInputElement | null>) => ({
    ref,
    type: "file" as const,
    // The menu items carry the accessible names; the inputs stay out of the tree.
    "aria-hidden": true as const,
    tabIndex: -1,
    className: "sr-only",
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      takeFile(event.target.files);
      event.target.value = "";
    },
  });

  return (
    <>
      <PromptInputActionMenu>
        <PromptInputActionMenuTrigger aria-label="Attach asset evidence" disabled={disabled}>
          <PlusIcon className="size-4" />
        </PromptInputActionMenuTrigger>
        <PromptInputActionMenuContent className="min-w-48">
          {/* Camera-first entry where a camera is in hand (mirrors the drop zone). */}
          <PromptInputActionMenuItem
            className={cn(CAPTURE_ENTRY, "sm:hidden")}
            onSelect={() => cameraRef.current?.click()}
          >
            <CameraIcon aria-hidden className="size-4" />
            Take a photo
          </PromptInputActionMenuItem>
          <PromptInputActionMenuItem
            className={CAPTURE_ENTRY}
            onSelect={() => photoRef.current?.click()}
          >
            <ImageIcon aria-hidden className="size-4" />
            Photo library
          </PromptInputActionMenuItem>
          <PromptInputActionMenuItem
            className={CAPTURE_ENTRY}
            onSelect={() => fileRef.current?.click()}
          >
            <PaperclipIcon aria-hidden className="size-4" />
            Attach a file
          </PromptInputActionMenuItem>
        </PromptInputActionMenuContent>
      </PromptInputActionMenu>

      <input accept="image/*" capture="environment" {...pickerProps(cameraRef)} />
      <input accept="image/*" {...pickerProps(photoRef)} />
      <input accept={ASSET_EVIDENCE_ALLOWED_MIME_TYPES.join(",")} {...pickerProps(fileRef)} />
    </>
  );
}
