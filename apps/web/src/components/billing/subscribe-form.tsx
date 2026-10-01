"use client";

import { useFormStatus } from "react-dom";
import { startCheckoutAction } from "@/app/actions/checkout";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

function IntervalButton({
  interval,
  label,
  variant,
}: {
  interval: "monthly" | "annual";
  label: string;
  variant: "default" | "outline";
}) {
  const { pending, data } = useFormStatus();
  const chosen = pending && data?.get("interval") === interval;

  return (
    <Button
      type="submit"
      name="interval"
      value={interval}
      variant={variant}
      className="w-full"
      disabled={pending}
    >
      {chosen ? <Spinner data-icon="inline-start" /> : null}
      {label}
    </Button>
  );
}

/** Subscribe from the pending area: one plan, paid monthly or annually, in Stripe Checkout. */
export function SubscribeForm() {
  return (
    <form action={startCheckoutAction} className="flex flex-col gap-2">
      <IntervalButton interval="monthly" label="Subscribe for $20 a month" variant="default" />
      <IntervalButton interval="annual" label="Subscribe for $200 a year" variant="outline" />
      <p className="text-center text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
        Plus sales tax where it applies. Card payments from the US only.
      </p>
    </form>
  );
}
