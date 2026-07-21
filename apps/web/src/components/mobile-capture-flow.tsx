"use client";

import type { ConversationalCaptureConfirmation } from "@tendnote/domain/conversational-capture";
import { type RefObject, useEffect, useRef, useState } from "react";
import { MobileFailureState } from "@/components/mobile-failure-state";
import { Button } from "@/components/ui/button";
import { useLocalComposerDraft } from "@/lib/local-composer-draft";

export type CaptureSubmitInput = {
  interactionId: string;
  inputMode: "typed" | "dictated";
  originalText: string;
};

export type CaptureSubmitResult = { confirmation: ConversationalCaptureConfirmation };

export type CaptureHandlers = {
  change: (input: { savedItemId: string; originalText: string }) => Promise<unknown>;
  submit: (input: CaptureSubmitInput) => Promise<CaptureSubmitResult>;
  undo: (input: { savedItemId: string }) => Promise<unknown>;
};

type CaptureFlowProps = {
  handlers?: CaptureHandlers;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  ownerUserId: string;
};

type CaptureState = {
  confirmation: ConversationalCaptureConfirmation | null;
  dictating: boolean;
  dictationMessage: string | null;
  editText: string;
  editing: boolean;
  failure: "change" | "submit" | "undo" | null;
  inputMode: "typed" | "dictated";
  pending: boolean;
  undone: boolean;
};

type SpeechRecognitionEventLike = {
  results: ArrayLike<{ 0?: { transcript?: string } }>;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function speechRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  const browser = globalThis as typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}

function useCaptureController({ handlers, inputRef, ownerUserId }: CaptureFlowProps) {
  const draft = useLocalComposerDraft(ownerUserId, "capture");
  const interactionId = useRef(globalThis.crypto.randomUUID());
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const [state, setState] = useState<CaptureState>({
    confirmation: null,
    dictating: false,
    dictationMessage: null,
    editText: "",
    editing: false,
    failure: null,
    inputMode: "typed",
    pending: false,
    undone: false,
  });
  const update = (patch: Partial<CaptureState>) =>
    setState((current) => ({ ...current, ...patch }));

  useEffect(
    () => () => {
      const active = recognition.current;
      if (!active) return;
      active.onend = null;
      active.onerror = null;
      active.onresult = null;
      active.stop();
      recognition.current = null;
    },
    [],
  );

  async function submit() {
    if (!handlers?.submit || !draft.value.trim() || state.pending) return;
    update({ failure: null, pending: true });
    try {
      const originalText = draft.value.trim();
      const result = await handlers.submit({
        interactionId: interactionId.current,
        inputMode: state.inputMode,
        originalText,
      });
      update({ confirmation: result.confirmation, editText: originalText });
      draft.clear();
    } catch {
      update({ failure: "submit" });
    } finally {
      update({ pending: false });
    }
  }

  async function change() {
    if (!state.confirmation || !handlers?.change || !state.editText.trim() || state.pending) return;
    update({ failure: null, pending: true });
    try {
      await handlers.change({
        savedItemId: state.confirmation.change.savedItemId,
        originalText: state.editText.trim(),
      });
      update({ editing: false });
    } catch {
      update({ failure: "change" });
    } finally {
      update({ pending: false });
    }
  }

  async function undo() {
    if (!state.confirmation || !handlers?.undo || state.pending) return;
    update({ failure: null, pending: true });
    try {
      await handlers.undo({ savedItemId: state.confirmation.undo.savedItemId });
      update({ undone: true });
    } catch {
      update({ failure: "undo" });
    } finally {
      update({ pending: false });
    }
  }

  function toggleDictation() {
    if (state.dictating) {
      recognition.current?.stop();
      return;
    }
    const Recognition = speechRecognitionConstructor();
    if (!Recognition) {
      update({
        dictationMessage:
          "Live dictation is not supported in this browser. You can paste or use keyboard dictation.",
      });
      return;
    }
    const nextRecognition = new Recognition();
    recognition.current = nextRecognition;
    nextRecognition.continuous = false;
    nextRecognition.interimResults = false;
    nextRecognition.lang = navigator.language;
    nextRecognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (transcript) {
        draft.setValue([draft.value.trim(), transcript].filter(Boolean).join(" "));
        update({ dictationMessage: "Dictated transcript added.", inputMode: "dictated" });
      }
    };
    nextRecognition.onerror = () =>
      update({
        dictating: false,
        dictationMessage: "Dictation stopped without changing the draft.",
      });
    nextRecognition.onend = () => update({ dictating: false });
    update({ dictating: true, dictationMessage: "Listening for one dictated note…" });
    nextRecognition.start();
  }

  function discard() {
    recognition.current?.stop();
    interactionId.current = globalThis.crypto.randomUUID();
    draft.clear();
    update({
      dictating: false,
      dictationMessage: null,
      failure: null,
      inputMode: "typed",
    });
  }

  function setDraftValue(value: string) {
    if (state.failure === "submit") {
      interactionId.current = globalThis.crypto.randomUUID();
      update({ failure: null });
    }
    draft.setValue(value);
  }

  return {
    change,
    discard,
    draft,
    inputRef,
    setDraftValue,
    state,
    submit,
    toggleDictation,
    undo,
    update,
  };
}

function CaptureCorrection({
  controller,
}: {
  controller: ReturnType<typeof useCaptureController>;
}) {
  const { change, state, update } = controller;
  return (
    <>
      <label className="font-medium text-sm" htmlFor="mobile-capture-change">
        Change saved wording
      </label>
      <textarea
        className="min-h-40 w-full resize-none rounded-xl border bg-background p-4 text-base leading-6 outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
        id="mobile-capture-change"
        onChange={(event) => update({ editText: event.target.value })}
        value={state.editText}
      />
      {state.failure === "change" ? (
        <MobileFailureState kind="capture_change" onRetry={change} />
      ) : null}
      <div className="flex gap-2">
        <Button
          onClick={() => update({ editing: false, failure: null })}
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
        <Button
          aria-busy={state.pending}
          disabled={!state.editText.trim() || state.pending}
          onClick={change}
          type="button"
        >
          {state.pending ? "Saving…" : "Save change"}
        </Button>
      </div>
    </>
  );
}

function CaptureConfirmation({
  controller,
  handlers,
}: {
  controller: ReturnType<typeof useCaptureController>;
  handlers: CaptureFlowProps["handlers"];
}) {
  const { state, undo, update } = controller;
  const confirmation = state.confirmation;
  if (!confirmation) return null;
  return (
    <div className="flex flex-1 flex-col justify-center gap-4" role="status">
      <h3 className="font-semibold text-xl">{state.undone ? "Capture undone" : "Capture saved"}</h3>
      {state.undone ? (
        <p className="text-muted-foreground text-sm">
          The Saved Item was archived. Its source evidence remains available for audit.
        </p>
      ) : state.editing ? (
        <CaptureCorrection controller={controller} />
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 rounded-xl border bg-panel p-4 text-sm">
            <dt className="text-muted-foreground">Destination</dt>
            <dd>{confirmation.destination}</dd>
            <dt className="text-muted-foreground">Saved as</dt>
            <dd>{confirmation.interpreted.kind}</dd>
            <dt className="text-muted-foreground">Visible to</dt>
            <dd>{confirmation.interpreted.visibility}</dd>
            <dt className="text-muted-foreground">Grounding</dt>
            <dd>Original capture retained as source evidence</dd>
          </dl>
          {state.failure === "undo" ? (
            <MobileFailureState kind="capture_undo" onRetry={undo} />
          ) : null}
          <div className="flex gap-2">
            <Button
              disabled={!handlers?.change || state.pending}
              onClick={() => update({ editing: true, failure: null })}
              type="button"
              variant="outline"
            >
              Change
            </Button>
            <Button
              disabled={!handlers?.undo || state.pending}
              onClick={undo}
              type="button"
              variant="ghost"
            >
              Undo
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function CaptureComposer({
  controller,
  handlers,
}: {
  controller: ReturnType<typeof useCaptureController>;
  handlers: CaptureFlowProps["handlers"];
}) {
  const { discard, draft, inputRef, setDraftValue, state, submit, toggleDictation, update } =
    controller;
  return (
    <>
      {draft.restored ? (
        <p className="text-muted-foreground text-sm" role="status">
          Unsaved draft restored on this device.
        </p>
      ) : null}
      <label className="font-medium text-sm" htmlFor="mobile-capture-input">
        What should Tendnote keep?
      </label>
      <textarea
        className="min-h-40 w-full resize-none rounded-xl border bg-background p-4 text-base leading-6 outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
        id="mobile-capture-input"
        onChange={(event) => setDraftValue(event.target.value)}
        placeholder="Capture a note, reminder, link, or open question…"
        ref={inputRef}
        value={draft.value}
      />
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Capture input mode</legend>
        {(["typed", "dictated"] as const).map((mode) => (
          <Button
            aria-pressed={state.inputMode === mode}
            key={mode}
            onClick={() => update({ inputMode: mode })}
            size="sm"
            type="button"
            variant={state.inputMode === mode ? "secondary" : "ghost"}
          >
            {mode === "typed" ? "Typed" : "Dictated transcript"}
          </Button>
        ))}
      </fieldset>
      <Button onClick={toggleDictation} type="button" variant="outline">
        {state.dictating ? "Stop dictation" : "Start dictation"}
      </Button>
      {state.dictationMessage ? (
        <p className="text-muted-foreground text-xs" role="status">
          {state.dictationMessage}
        </p>
      ) : null}
      <p className="text-muted-foreground text-xs">
        This text is unsaved and stays only on this device for up to 24 hours. Tendnote keeps the
        transcript, not audio.
      </p>
      {state.failure === "submit" ? (
        <MobileFailureState kind="capture_save" onRetry={submit} />
      ) : null}
      {!handlers?.submit ? (
        <p className="text-muted-foreground text-xs" role="status">
          Capture routing is temporarily unavailable. Your draft remains safe to copy or discard.
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
        <Button className="min-h-11" onClick={discard} size="lg" type="button" variant="ghost">
          Discard draft
        </Button>
        <Button
          aria-busy={state.pending}
          className="min-h-11"
          disabled={!handlers?.submit || !draft.value.trim() || state.pending}
          onClick={submit}
          size="lg"
          type="button"
        >
          {state.pending ? "Saving…" : "Save capture"}
        </Button>
      </div>
    </>
  );
}

export function MobileCaptureFlow(props: CaptureFlowProps) {
  const controller = useCaptureController(props);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      {controller.state.confirmation ? (
        <CaptureConfirmation controller={controller} handlers={props.handlers} />
      ) : (
        <CaptureComposer controller={controller} handlers={props.handlers} />
      )}
    </div>
  );
}
