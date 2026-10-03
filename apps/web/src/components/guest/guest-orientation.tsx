import { finishGuestOrientationAction } from "@/app/actions/guest-orientation";
import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { EyeIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

const SMALL = "text-[length:var(--text-small)] leading-[var(--text-small-line)]";

/**
 * The one-time orientation a Household Guest meets before the library (#636):
 * whose household this is, that the view is read-only, what they can see, and
 * what they cannot. It names no paid feature, so it advertises nothing.
 */
export function GuestOrientation({ householdName }: { householdName: string }) {
  return (
    <AuthScaffold
      title={`You're a guest of ${householdName}`}
      subtitle="Here is what you can read here, and what you can't do."
    >
      <form action={finishGuestOrientationAction} className="flex flex-col gap-5">
        <dl className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <dt className="font-medium">You can read</dt>
            <dd className={`${SMALL} text-muted-foreground text-pretty`}>
              What the household holds in common, and anything a member shared with you: people,
              memories, follow-ups, actions, assets, gift plans you co-plan, household context, and
              the household calendar.
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-medium">You can't change anything</dt>
            <dd className={`${SMALL} text-muted-foreground text-pretty`}>
              The records belong to the household's members. You can read them, not add to them or
              edit them.
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-medium">Private records aren't part of this view</dt>
            <dd className={`${SMALL} text-muted-foreground text-pretty`}>
              What a member keeps to themselves isn't hidden from you here. It simply isn't here.
            </dd>
          </div>
        </dl>
        <p
          className={`${SMALL} flex items-start gap-2 rounded-lg border bg-surface px-3 py-2.5 text-muted-foreground text-pretty`}
        >
          <EyeIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />A band at the top
          of the library keeps saying this, so you never have to guess why something isn't there.
        </p>
        <Button type="submit" className="w-full">
          Open the library
        </Button>
      </form>
    </AuthScaffold>
  );
}
