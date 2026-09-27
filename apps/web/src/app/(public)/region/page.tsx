import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { MARKETING_URL, SELF_HOSTING_GUIDE_URL } from "@/lib/public-links";

export const metadata = {
  title: "Not available in your region",
  robots: { index: false, follow: false },
};

/**
 * Where the hosted Region Block sends a refused visitor. It explains where the
 * hosted service operates and points to the two places that remain open:
 * marketing, which is readable everywhere, and self-hosting, which carries no
 * regional restriction.
 */
export default function RegionPage() {
  return (
    <AuthScaffold
      title="Not available in your region"
      subtitle="Hosted Tendnote operates only in the United States for now, so sign-up, sign-in, and the app aren't available from the EU, the EEA, the UK, or Switzerland."
    >
      <div className="flex flex-col gap-4 text-[length:var(--text-small)] leading-[var(--text-small-line)]">
        <p className="text-muted-foreground text-pretty">
          Tendnote is open source. You can run your own copy on your own accounts, wherever you are.
        </p>
        <div className="flex flex-col gap-2">
          <a
            className="font-medium text-foreground underline-offset-4 hover:underline"
            href={SELF_HOSTING_GUIDE_URL}
          >
            Read the self-hosting guide
          </a>
          <a
            className="font-medium text-foreground underline-offset-4 hover:underline"
            href={MARKETING_URL}
          >
            Learn more about Tendnote
          </a>
        </div>
      </div>
    </AuthScaffold>
  );
}
