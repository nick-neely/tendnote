import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { AdmissionPoller } from "@/components/billing/admission-poller";
import { Spinner } from "@/components/ui/spinner";
import { getCurrentAccess } from "@/lib/access/current-access";

/**
 * Where Stripe Checkout returns (#606). Returning admits nobody: this page only
 * reads Tendnote's own admission record, never Stripe, and lets the customer in
 * once the first paid invoice has been projected onto Paid Access.
 */
export default async function ConfirmingPage() {
  if (process.env.NODE_ENV !== "test") await connection();
  const access = await getCurrentAccess();

  if (access.state === "unauthenticated") {
    redirect("/sign-in");
  }

  if (access.state === "admitted") {
    redirect("/");
  }

  return (
    <AuthScaffold
      title="Confirming your payment"
      subtitle="This usually takes a few seconds. You'll be let in as soon as your payment is confirmed."
    >
      <div
        role="status"
        className="flex items-center justify-center gap-2 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground"
      >
        <Spinner aria-hidden />
        Waiting for confirmation
      </div>
      <AdmissionPoller />
    </AuthScaffold>
  );
}
