"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2Icon } from "@/components/icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { authClient, signOut } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

/** What a refused deletion tells the person, by Better Auth's error code. */
function deletionErrorMessage(error: { code?: string; message?: string }): string {
  if (error.code === "SESSION_EXPIRED") {
    return "For your security, sign out and sign back in, then delete the account.";
  }
  return error.message || "Tendnote couldn't delete the account. Try again.";
}

/**
 * Self-service deletion, on the Account page's deletion screen (#619) and in
 * every area without one, such as the pending area (#607). It is always
 * offered, so the exit is never blocked. Better Auth re-checks the session and
 * Tendnote's deletion hook does the deleting (#616); once it is accepted the
 * session is already revoked, so the browser only signs out.
 */
export function DeleteAccountButton({
  email,
  className,
  variant = "ghost",
}: {
  email: string;
  className?: string;
  /** Ghost where Delete sits beside Sign out; destructive on the deletion screen. */
  variant?: "ghost" | "destructive";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount() {
    setPending(true);
    setError(null);
    try {
      const result = await authClient.deleteUser();
      if (result.error) {
        setError(deletionErrorMessage(result.error));
        setPending(false);
        return;
      }
    } catch {
      setError("Tendnote couldn't delete the account. Try again.");
      setPending(false);
      return;
    }

    // The account is closed either way; a failed sign-out only leaves an inert cookie.
    await signOut().catch(() => undefined);
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <AlertDialog
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) setError(null);
      }}
      open={open}
    >
      <AlertDialogTrigger asChild>
        <Button
          className={cn(
            variant === "ghost" && "w-full text-muted-foreground hover:text-destructive",
            className,
          )}
          type="button"
          variant={variant}
        >
          <Trash2Icon aria-hidden data-icon="inline-start" />
          Delete account
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this account?</AlertDialogTitle>
          <AlertDialogDescription>
            The account for <span className="font-medium text-foreground">{email}</span> closes now
            and its private records are deleted. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p className="text-[length:var(--text-small)] text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep account</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              void deleteAccount();
            }}
            variant="destructive"
          >
            {pending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
            {pending ? "Deleting…" : "Delete account"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
