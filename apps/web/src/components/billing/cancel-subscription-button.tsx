"use client";

import { useFormStatus } from "react-dom";
import { openSubscriptionCancelAction } from "@/app/actions/billing-portal";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="outline" className="w-full" disabled={pending}>
      {pending ? <Spinner data-icon="inline-start" /> : null}
      Cancel subscription
    </Button>
  );
}

/** Opens Stripe's cancel-at-period-end flow for a suspended account's subscription (#629). */
export function CancelSubscriptionButton() {
  return (
    <form action={openSubscriptionCancelAction}>
      <SubmitButton />
    </form>
  );
}
