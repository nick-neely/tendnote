"use client";

import { useFormStatus } from "react-dom";
import { openBillingPortalAction } from "@/app/actions/billing-portal";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

function SubmitButton({ variant }: { variant: "outline" | "link" }) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant={variant}
      size="sm"
      className={variant === "link" ? "h-auto p-0" : undefined}
      disabled={pending}
    >
      {pending ? <Spinner data-icon="inline-start" /> : null}
      Manage billing
    </Button>
  );
}

/** Opens the Stripe portal for the signed-in account (#609). */
export function ManageBillingButton({ variant = "outline" }: { variant?: "outline" | "link" }) {
  return (
    <form action={openBillingPortalAction}>
      <SubmitButton variant={variant} />
    </form>
  );
}
