/** Fallback message when a follow-up mutation fails for an unknown reason. */
export const GENERIC_ERROR = "That didn't go through. Try again.";

/** Inline error line shared by the follow-up rows and the create form. */
export function ErrorText({ message }: { message: string }) {
  return (
    <p className="text-[length:var(--text-small)] text-destructive" role="alert">
      {message}
    </p>
  );
}
