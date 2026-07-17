"use client";

import { toast } from "sonner";
import type { ToastPlan } from "./review-model";

// The only place a described outcome (`ToastPlan`) becomes a rendered toast. A table
// lookup rather than a tone branch, so this stays a pass-through and no wording or
// "should we speak at all?" policy leaks out of `review-model`.
const TOAST_BY_TONE = {
  success: toast.success,
  error: toast.error,
  info: toast.info,
} as const;

/** Show a planned toast. A `null` plan means the surface deliberately says nothing. */
export function presentToast(plan: ToastPlan | null): void {
  if (!plan) {
    return;
  }
  TOAST_BY_TONE[plan.tone](
    plan.message,
    plan.description ? { description: plan.description } : undefined,
  );
}
