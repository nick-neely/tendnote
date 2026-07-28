"use client";

import type { ReminderInstallationSummary, ReminderOptInState } from "@tendnote/domain/reminders";
import { useEffect, useState } from "react";
import {
  beginReminderInstallationOptInAction,
  disableCurrentReminderInstallationAction,
  getReminderInstallationStateAction,
  registerReminderInstallationAction,
  revokeReminderInstallationAction,
  setReminderInstallationPreviewModeAction,
  setReminderOptInDecisionAction,
} from "@/app/actions/reminders";
import { unwrapOwnerActionResult } from "@/lib/owner-action-result";
import {
  attemptReminderRegistration,
  getExistingReminderInstallationId,
  isStandaloneReminderContext,
  type ReminderRegistrationOutcome,
  unsubscribeReminderRegistration,
} from "@/lib/reminder-registration";

type InstallationState = ReminderOptInState["state"] | null;

export function useReminderInstallationSettings(initialItems: ReminderInstallationSummary[]) {
  const [items, setItems] = useState(initialItems);
  const [currentClientId, setCurrentClientId] = useState<string | null>(null);
  const [currentOptInState, setCurrentOptInState] = useState<InstallationState>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [registrationOutcome, setRegistrationOutcome] =
    useState<ReminderRegistrationOutcome | null>(null);

  useEffect(() => {
    const clientInstallationId = getExistingReminderInstallationId(window.localStorage);
    setCurrentClientId(clientInstallationId);
    if (!clientInstallationId) return;
    getReminderInstallationStateAction({ clientInstallationId })
      .then((result) => {
        const state = unwrapOwnerActionResult(result);
        setCurrentOptInState(state.optInState);
        if (state.installation) {
          setItems((current) => [
            state.installation as ReminderInstallationSummary,
            ...current.filter((item) => item.id !== state.installation?.id),
          ]);
        }
      })
      .catch(() => setMessage("Tendnote couldn't refresh reminder settings. Try again."));
  }, []);

  async function changePreview(installation: ReminderInstallationSummary, detailed: boolean) {
    setPending(`preview:${installation.id}`);
    setMessage(null);
    try {
      const result = unwrapOwnerActionResult(
        await setReminderInstallationPreviewModeAction({
          clientInstallationId: installation.clientInstallationId,
          previewMode: detailed ? "detailed" : "generic",
        }),
      );
      setItems((current) =>
        current.map((item) =>
          item.id === installation.id ? { ...item, previewMode: result.previewMode } : item,
        ),
      );
    } catch {
      setMessage("Tendnote couldn't change preview privacy. Try again.");
    } finally {
      setPending(null);
    }
  }

  async function turnOffCurrent(installation: ReminderInstallationSummary) {
    setPending(`disable:${installation.id}`);
    setMessage(null);
    try {
      unwrapOwnerActionResult(
        await disableCurrentReminderInstallationAction({
          clientInstallationId: installation.clientInstallationId,
          reason: "current_installation",
        }),
      );
      await unsubscribeReminderRegistration(
        "serviceWorker" in navigator ? navigator.serviceWorker : null,
      );
      setItems((current) =>
        current.map((item) =>
          item.id === installation.id ? { ...item, status: "disabled" } : item,
        ),
      );
      setCurrentOptInState("disabled");
      setMessage("Reminders are off on this installation.");
    } catch {
      setMessage("Tendnote couldn't turn reminders off. Try again.");
    } finally {
      setPending(null);
    }
  }

  async function revokeRemote(installation: ReminderInstallationSummary) {
    setPending(`revoke:${installation.id}`);
    setMessage(null);
    try {
      unwrapOwnerActionResult(
        await revokeReminderInstallationAction({ installationId: installation.id }),
      );
      setItems((current) =>
        current.map((item) =>
          item.id === installation.id ? { ...item, status: "revoked" } : item,
        ),
      );
      setMessage(`${installation.label} was revoked.`);
    } catch {
      setMessage(`Tendnote couldn't revoke ${installation.label}. Try again.`);
    } finally {
      setPending(null);
    }
  }

  async function enableAgain() {
    if (!currentClientId) return;
    setPending("enable");
    setMessage(null);
    setRegistrationOutcome(null);
    try {
      const outcome = await attemptReminderRegistration({
        clientInstallationId: currentClientId,
        publicKey: process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY ?? "",
        userAgent: navigator.userAgent,
        standalone: isStandaloneReminderContext(),
        notification: "Notification" in window ? Notification : null,
        serviceWorker: "serviceWorker" in navigator ? navigator.serviceWorker : null,
        pushSupported: "PushManager" in window,
        begin: async () =>
          unwrapOwnerActionResult(
            await beginReminderInstallationOptInAction({
              clientInstallationId: currentClientId,
            }),
          ),
        register: async (input) =>
          unwrapOwnerActionResult(await registerReminderInstallationAction(input)),
        decide: async (decision) =>
          unwrapOwnerActionResult(
            await setReminderOptInDecisionAction({
              clientInstallationId: currentClientId,
              decision,
            }),
          ),
      });
      setRegistrationOutcome(outcome);
      if (outcome.status === "denied" || outcome.status === "postponed") {
        setCurrentOptInState(outcome.status);
      } else if (outcome.status === "enabled") {
        const state = unwrapOwnerActionResult(
          await getReminderInstallationStateAction({
            clientInstallationId: currentClientId,
          }),
        );
        setCurrentOptInState(state.optInState);
        if (state.installation) {
          setItems((current) => [
            state.installation as ReminderInstallationSummary,
            ...current.filter((item) => item.id !== state.installation?.id),
          ]);
        }
      }
    } catch {
      setMessage("Tendnote couldn't enable reminders. Try again.");
    } finally {
      setPending(null);
    }
  }

  const current = items.find((item) => item.clientInstallationId === currentClientId) ?? null;
  const recoveryAction =
    registrationOutcome?.status === "registration_failed"
      ? "Try again"
      : currentOptInState === "denied"
        ? "Check again"
        : null;
  return {
    changePreview,
    current,
    currentClientId,
    currentOptInState,
    enableAgain,
    items,
    message,
    pending,
    recoveryAction,
    registrationOutcome,
    revokeRemote,
    turnOffCurrent,
  };
}
