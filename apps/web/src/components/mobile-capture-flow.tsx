"use client";

import type {
  ConversationalCaptureChangeTarget,
  ConversationalCaptureClarification,
  ConversationalCaptureConfirmation,
  ConversationalCaptureOutcomeConfirmation,
  ConversationalCaptureUndoTarget,
} from "@tendnote/domain/conversational-capture";
import { type RefObject, useEffect, useRef, useState } from "react";
import {
  type CaptureReminderChange,
  CaptureReminderScheduleChange,
} from "@/components/capture-reminder-schedule-change";
import { MobileFailureState } from "@/components/mobile-failure-state";
import {
  reminderInstallationIdentity,
  useReminderInstallation,
} from "@/components/reminder-installation-context";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { captureOutcomePresentation } from "@/lib/capture-outcome-presentation";
import { useLocalComposerDraft } from "@/lib/local-composer-draft";
import {
  type OwnerActionResult,
  ownerActionFailureMessage,
  unwrapOwnerActionResult,
} from "@/lib/owner-action-result";

export type CaptureSubmitInput = {
  clarificationAnswer?: string;
  interactionId: string;
  inputMode: "typed" | "dictated";
  originalText: string;
  clientInstallationId?: string;
  timeZone?: string;
};

export type CaptureSubmitResult =
  | { confirmation: ConversationalCaptureConfirmation; reminderOptInOffered?: boolean }
  | { clarification: ConversationalCaptureClarification };

type CaptureChangeResult = {
  clarification?: ConversationalCaptureClarification;
  confirmation?: ConversationalCaptureConfirmation;
  ok?: true;
};

export type CaptureHandlers = {
  addPerson?: (input: {
    displayName: string;
    sourceRecordId: string;
    unresolvedMentionId?: string;
  }) => Promise<OwnerActionResult<{ displayName: string }>>;
  change: (input: {
    clarificationAnswer?: string;
    target: ConversationalCaptureChangeTarget;
    originalText: string;
  }) => Promise<OwnerActionResult<CaptureChangeResult>>;
  changeReminder?: CaptureReminderChange;
  submit: (input: CaptureSubmitInput) => Promise<OwnerActionResult<CaptureSubmitResult>>;
  undo: (input: { target: ConversationalCaptureUndoTarget }) => Promise<OwnerActionResult<unknown>>;
};

type CaptureFlowProps = {
  handlers?: CaptureHandlers;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  ownerUserId: string;
};

type CaptureState = {
  activeOutcomeIndex: number;
  clarification: ConversationalCaptureClarification | null;
  clarificationAnswer: string;
  clarificationTarget: ConversationalCaptureChangeTarget | null;
  confirmation: ConversationalCaptureConfirmation | null;
  dictating: boolean;
  dictationMessage: string | null;
  editText: string;
  editing: boolean;
  failure: "change" | "submit" | "undo" | null;
  failureMessage: string | null;
  inputMode: "typed" | "dictated";
  originalText: string;
  pending: boolean;
  undone: boolean;
  undoneOutcomeIndexes: number[];
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

function captureOutcomeAt(
  confirmation: ConversationalCaptureConfirmation | null,
  index: number,
): ConversationalCaptureOutcomeConfirmation | null {
  if (!confirmation) return null;
  return confirmation.destination === "Grouped"
    ? (confirmation.outcomes[index] ?? null)
    : confirmation;
}

function replaceGroupedOutcome(
  current: ConversationalCaptureConfirmation | null,
  index: number,
  replacement?: ConversationalCaptureConfirmation,
): ConversationalCaptureConfirmation | null {
  if (!replacement) return current;
  if (current?.destination !== "Grouped" || replacement.destination === "Grouped") {
    return replacement;
  }
  return {
    ...current,
    outcomes: current.outcomes.map((outcome, outcomeIndex) =>
      outcomeIndex === index ? replacement : outcome,
    ),
  };
}

function useCaptureController({ handlers, inputRef, ownerUserId }: CaptureFlowProps) {
  const installation = useReminderInstallation();
  const draft = useLocalComposerDraft(ownerUserId, "capture");
  const interactionId = useRef(globalThis.crypto.randomUUID());
  const clarificationInputRef = useRef<HTMLInputElement>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const [state, setState] = useState<CaptureState>({
    activeOutcomeIndex: 0,
    clarification: null,
    clarificationAnswer: "",
    clarificationTarget: null,
    confirmation: null,
    dictating: false,
    dictationMessage: null,
    editText: "",
    editing: false,
    failure: null,
    failureMessage: null,
    inputMode: "typed",
    originalText: "",
    pending: false,
    undone: false,
    undoneOutcomeIndexes: [],
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

  function applySubmitResult(result: CaptureSubmitResult, originalText: string) {
    if ("clarification" in result) {
      update({
        activeOutcomeIndex: 0,
        clarification: result.clarification,
        clarificationAnswer: "",
        clarificationTarget: null,
        editText: originalText,
        originalText,
      });
    } else {
      if (result.reminderOptInOffered) installation?.offerReminderOptIn();
      update({
        activeOutcomeIndex: 0,
        clarification: null,
        clarificationTarget: null,
        confirmation: result.confirmation,
        editText: originalText,
      });
    }
  }

  function applyChangeResult(
    result: CaptureChangeResult,
    originalText: string,
    target: ConversationalCaptureChangeTarget,
  ) {
    if (result.clarification) {
      update({
        clarification: result.clarification,
        clarificationAnswer: "",
        clarificationTarget: target,
        editing: false,
        originalText,
      });
    } else {
      const nextConfirmation = replaceGroupedOutcome(
        state.confirmation,
        state.activeOutcomeIndex,
        result.confirmation,
      );
      update({
        clarification: null,
        clarificationTarget: null,
        confirmation: nextConfirmation,
        editing: false,
      });
    }
  }

  async function submit() {
    const originalText = state.clarification ? state.originalText : draft.value.trim();
    const clarificationAnswer = state.clarification ? state.clarificationAnswer.trim() : undefined;
    if (
      !handlers?.submit ||
      !originalText ||
      (state.clarification && !clarificationAnswer) ||
      state.pending
    )
      return;
    update({ failure: null, failureMessage: null, pending: true });
    try {
      const result = unwrapOwnerActionResult(
        await handlers.submit({
          ...(clarificationAnswer ? { clarificationAnswer } : {}),
          interactionId: interactionId.current,
          inputMode: state.inputMode,
          originalText,
          ...(installation ? reminderInstallationIdentity(installation) : {}),
        }),
      );
      applySubmitResult(result, originalText);
      draft.clear();
    } catch (error) {
      update({ failure: "submit", failureMessage: userSafeActionMessage(error) });
    } finally {
      update({ pending: false });
    }
  }

  async function change() {
    const originalText = state.clarificationTarget ? state.originalText : state.editText.trim();
    const clarificationAnswer = state.clarificationTarget
      ? state.clarificationAnswer.trim()
      : undefined;
    const selectedOutcome = captureOutcomeAt(state.confirmation, state.activeOutcomeIndex);
    if (
      !state.confirmation ||
      !selectedOutcome ||
      !handlers?.change ||
      !originalText ||
      (state.clarificationTarget && !clarificationAnswer) ||
      state.pending
    )
      return;
    update({ failure: null, failureMessage: null, pending: true });
    try {
      const result = unwrapOwnerActionResult(
        await handlers.change({
          ...(clarificationAnswer ? { clarificationAnswer } : {}),
          target: state.clarificationTarget ?? selectedOutcome.change,
          originalText,
        }),
      );
      applyChangeResult(result, originalText, state.clarificationTarget ?? selectedOutcome.change);
    } catch (error) {
      update({ failure: "change", failureMessage: userSafeActionMessage(error) });
    } finally {
      update({ pending: false });
    }
  }

  async function addPersonAndContinue(displayName: string, unresolvedMentionId?: string) {
    if (!handlers?.addPerson || state.pending || !state.clarification) return;
    const originalText = state.originalText;
    const target = state.clarificationTarget;
    update({ failure: null, failureMessage: null, pending: true });
    try {
      const person = unwrapOwnerActionResult(
        await handlers.addPerson({
          displayName,
          sourceRecordId: state.clarification.sourceRecordId,
          ...(unresolvedMentionId ? { unresolvedMentionId } : {}),
        }),
      );
      if (target && state.confirmation) {
        const result = unwrapOwnerActionResult(
          await handlers.change({
            clarificationAnswer: person.displayName,
            target,
            originalText,
          }),
        );
        applyChangeResult(result, originalText, target);
      } else {
        const result = unwrapOwnerActionResult(
          await handlers.submit({
            clarificationAnswer: person.displayName,
            interactionId: interactionId.current,
            inputMode: state.inputMode,
            originalText,
          }),
        );
        applySubmitResult(result, originalText);
        draft.clear();
      }
    } catch (error) {
      update({
        failure: target ? "change" : "submit",
        failureMessage: userSafeActionMessage(error),
      });
    } finally {
      update({ pending: false });
    }
  }

  async function undo(outcomeIndex = state.activeOutcomeIndex) {
    const selectedOutcome = captureOutcomeAt(state.confirmation, outcomeIndex);
    if (
      !state.confirmation ||
      !selectedOutcome ||
      !("undo" in selectedOutcome) ||
      !handlers?.undo ||
      state.pending
    )
      return;
    update({ failure: null, failureMessage: null, pending: true });
    try {
      unwrapOwnerActionResult(await handlers.undo({ target: selectedOutcome.undo }));
      update({
        undone: state.confirmation.destination === "Grouped" ? state.undone : true,
        undoneOutcomeIndexes: [...new Set([...state.undoneOutcomeIndexes, outcomeIndex])],
      });
    } catch (error) {
      update({ failure: "undo", failureMessage: userSafeActionMessage(error) });
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
          "This browser doesn't support live dictation. Paste text or use your keyboard's dictation instead.",
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
      activeOutcomeIndex: 0,
      dictating: false,
      dictationMessage: null,
      failure: null,
      inputMode: "typed",
      clarification: null,
      clarificationAnswer: "",
      clarificationTarget: null,
      originalText: "",
      undone: false,
      undoneOutcomeIndexes: [],
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
    addPersonAndContinue,
    canAddPerson: Boolean(handlers?.addPerson),
    change,
    clarificationInputRef,
    continueClarification: state.clarificationTarget ? change : submit,
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
  const correctionInputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    correctionInputRef.current?.focus();
  }, []);
  return (
    <>
      <Label className="text-sm" htmlFor="mobile-capture-change">
        Rewrite what Tendnote saved
      </Label>
      <Textarea
        className="min-h-40 resize-none rounded-xl p-4 leading-6 md:text-base"
        id="mobile-capture-change"
        onChange={(event) => update({ editText: event.target.value })}
        ref={correctionInputRef}
        value={state.editText}
      />
      {state.failure === "change" ? (
        <MobileFailureState kind="capture_change" message={state.failureMessage} onRetry={change} />
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

function CaptureConfirmationDetails({
  confirmation,
}: {
  confirmation: ConversationalCaptureConfirmation;
}) {
  const outcomes = confirmation.destination === "Grouped" ? confirmation.outcomes : [confirmation];
  return (
    <div className="divide-y rounded-xl border bg-panel">
      {outcomes.map((outcome) => (
        <CaptureOutcomeDetails key={captureOutcomePresentation(outcome).key} outcome={outcome} />
      ))}
      <p className="p-4 text-muted-foreground text-sm">Tendnote kept your original capture.</p>
    </div>
  );
}

function CaptureOutcomeDetails({ outcome }: { outcome: ConversationalCaptureOutcomeConfirmation }) {
  const presentation = captureOutcomePresentation(outcome);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 p-4 text-sm">
      <dt className="text-muted-foreground">Destination</dt>
      <dd>{outcome.destination}</dd>
      <dt className="text-muted-foreground">Saved as</dt>
      <dd>{presentation.description}</dd>
      <dt className="text-muted-foreground">Visible to</dt>
      <dd>{presentation.visibility}</dd>
      {presentation.dueAt ? (
        <>
          <dt className="text-muted-foreground">Due</dt>
          <dd>{new Date(presentation.dueAt).toLocaleString()}</dd>
        </>
      ) : null}
      {presentation.cadence ? (
        <>
          <dt className="text-muted-foreground">Cadence</dt>
          <dd>{presentation.cadence}</dd>
        </>
      ) : null}
      {presentation.reminderSchedule ? (
        <>
          <dt className="text-muted-foreground">Reminder schedule</dt>
          <dd>{presentation.reminderSchedule}</dd>
        </>
      ) : null}
    </dl>
  );
}

function CaptureConfirmationControls({
  controller,
  handlers,
}: {
  controller: ReturnType<typeof useCaptureController>;
  handlers: CaptureFlowProps["handlers"];
}) {
  const { state, undo, update } = controller;
  const confirmation = state.confirmation;
  if (!confirmation) return null;
  const outcomes = confirmation.destination === "Grouped" ? confirmation.outcomes : [confirmation];
  return (
    <>
      {state.failure === "undo" ? (
        <MobileFailureState kind="capture_undo" message={state.failureMessage} onRetry={undo} />
      ) : null}
      {outcomes.map((outcome, index) => (
        <div className="flex flex-col gap-2" key={captureOutcomePresentation(outcome).key}>
          <div className="flex items-center gap-2">
            {outcomes.length > 1 ? (
              <span className="mr-auto text-muted-foreground text-sm">{outcome.destination}</span>
            ) : null}
            <Button
              disabled={!handlers?.change || state.pending}
              onClick={() =>
                update({
                  activeOutcomeIndex: index,
                  editText: outcomes.length > 1 ? "" : state.editText,
                  editing: true,
                  failure: null,
                })
              }
              type="button"
              variant="outline"
            >
              Change
            </Button>
            {"undo" in outcome ? (
              <Button
                disabled={
                  !handlers?.undo || state.pending || state.undoneOutcomeIndexes.includes(index)
                }
                onClick={() => void undo(index)}
                type="button"
                variant="ghost"
              >
                {state.undoneOutcomeIndexes.includes(index) ? "Undone" : "Undo"}
              </Button>
            ) : null}
          </div>
          {captureOutcomePresentation(outcome).reminderSchedule ? (
            <CaptureReminderScheduleChange
              changeReminder={handlers?.changeReminder}
              confirmation={confirmation}
              index={index}
              onConfirmationChange={(next) => controller.update({ confirmation: next })}
              outcome={outcome}
            />
          ) : null}
        </div>
      ))}
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
  const { state } = controller;
  const confirmation = state.confirmation;
  if (!confirmation) return null;
  return (
    <div className="flex flex-1 flex-col justify-center gap-4" role="status">
      <h3 className="font-semibold text-xl">{state.undone ? "Capture undone" : "Capture saved"}</h3>
      {state.undone ? (
        <p className="text-muted-foreground text-sm">
          Tendnote applied the authoritative Undo to the {confirmation.destination} record. Your
          original capture is still saved.
        </p>
      ) : state.editing ? (
        <CaptureCorrection controller={controller} />
      ) : (
        <>
          <CaptureConfirmationDetails confirmation={confirmation} />
          <CaptureConfirmationControls controller={controller} handlers={handlers} />
        </>
      )}
    </div>
  );
}

function CaptureClarification({
  controller,
}: {
  controller: ReturnType<typeof useCaptureController>;
}) {
  const {
    addPersonAndContinue,
    canAddPerson,
    clarificationInputRef,
    continueClarification,
    state,
    update,
  } = controller;
  if (!state.clarification) return null;
  return (
    <div className="flex flex-1 flex-col gap-4">
      <p className="text-muted-foreground text-xs">Tendnote kept your original capture.</p>
      <Label className="text-sm" htmlFor="mobile-capture-clarification">
        {state.clarification.question}
      </Label>
      <input
        className="min-h-11 rounded-xl border bg-background px-4 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
        id="mobile-capture-clarification"
        onChange={(event) => update({ clarificationAnswer: event.target.value })}
        ref={clarificationInputRef}
        value={state.clarificationAnswer}
      />
      {state.clarification.actions ? (
        <div className="flex flex-wrap gap-2">
          {state.clarification.actions.map((action) =>
            action.kind === "add_person" ? (
              <Button
                disabled={!canAddPerson || state.pending}
                key={action.kind}
                onClick={() => addPersonAndContinue(action.displayName, action.unresolvedMentionId)}
                type="button"
                variant="outline"
              >
                {action.label}
              </Button>
            ) : (
              <Button
                key={action.kind}
                onClick={() => clarificationInputRef.current?.focus()}
                type="button"
                variant="ghost"
              >
                {action.label}
              </Button>
            ),
          )}
        </div>
      ) : null}
      {state.failure === "submit" || state.failure === "change" ? (
        <MobileFailureState
          kind={state.failure === "change" ? "capture_change" : "capture_save"}
          message={state.failureMessage}
          onRetry={continueClarification}
        />
      ) : null}
      <Button
        aria-busy={state.pending}
        disabled={!state.clarificationAnswer.trim() || state.pending}
        onClick={continueClarification}
        type="button"
      >
        {state.pending ? "Saving…" : "Continue"}
      </Button>
    </div>
  );
}

function userSafeActionMessage(error: unknown): string | null {
  return ownerActionFailureMessage(error);
}

function CaptureComposer({
  controller,
  handlers,
}: {
  controller: ReturnType<typeof useCaptureController>;
  handlers: CaptureFlowProps["handlers"];
}) {
  const { discard, draft, inputRef, setDraftValue, state, submit, toggleDictation } = controller;
  return (
    <>
      {draft.restored ? (
        <p className="text-muted-foreground text-sm" role="status">
          Unsaved draft restored on this device.
        </p>
      ) : null}
      <Label className="text-sm" htmlFor="mobile-capture-input">
        What should Tendnote keep?
      </Label>
      {/* Capture is the point of this screen, so the writing surface takes the
          room instead of a fixed 150px box floating above ~400px of nothing.
          `field-sizing-fixed` hands sizing to the flex layout; the min-height is
          the floor when the notes below it push the column into scroll.

          There is no manual Typed / Dictated control here any more. `inputMode`
          is still recorded - dictation sets it, discard resets it, and it rides
          along to capture metadata and the dedup hash - but it describes how the
          text arrived, which the app already knows and the owner should not have
          to declare. */}
      <Textarea
        className="min-h-40 flex-1 field-sizing-fixed resize-none rounded-xl p-4 leading-6 md:text-base"
        id="mobile-capture-input"
        onChange={(event) => setDraftValue(event.target.value)}
        placeholder="Capture a note, reminder, link, or open question…"
        ref={inputRef}
        value={draft.value}
      />
      {/* Same reach as the Discard/Save pair below: this is a thumb control on a
          phone, so it carries the 44px minimum rather than the default 32px. */}
      <Button
        className="min-h-11"
        onClick={toggleDictation}
        size="lg"
        type="button"
        variant="outline"
      >
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
        <MobileFailureState kind="capture_save" message={state.failureMessage} onRetry={submit} />
      ) : null}
      {!handlers?.submit ? (
        <p className="text-muted-foreground text-xs" role="status">
          Saving is temporarily unavailable. Your draft stays on this device so you can copy it.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-4">
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
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-gutter py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      {controller.state.clarification ? (
        <CaptureClarification controller={controller} />
      ) : controller.state.confirmation ? (
        <CaptureConfirmation controller={controller} handlers={props.handlers} />
      ) : (
        <CaptureComposer controller={controller} handlers={props.handlers} />
      )}
    </div>
  );
}
