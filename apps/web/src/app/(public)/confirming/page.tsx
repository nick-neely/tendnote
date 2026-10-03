import { parseAdmissionPolicy } from "@tendnote/domain";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { AdmissionPoller } from "@/components/billing/admission-poller";
import { ConfirmingStatus } from "@/components/billing/confirming-status";
import { getCurrentAccess } from "@/lib/access/current-access";

/**
 * Where Stripe Checkout returns (#606). Returning admits nobody: this page only
 * reads Tendnote's own admission record, never Stripe, and lets the customer in
 * once the first paid invoice has been projected onto Paid Access. After a
 * minute it promises the "you're in" email instead (#607).
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

  // Only hosted deployments take payment, so there is nothing to wait for here.
  if (parseAdmissionPolicy().mode !== "hosted") {
    redirect("/pending");
  }

  return (
    <AuthScaffold
      title="Confirming your payment"
      subtitle="This usually takes a few seconds. You'll be let in as soon as your payment is confirmed."
    >
      <ConfirmingStatus email={access.user.email} />
      <AdmissionPoller />
    </AuthScaffold>
  );
}
