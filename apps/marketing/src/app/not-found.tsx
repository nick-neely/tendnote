import { Button } from "@tendnote/ui/button";
import Link from "next/link";
import { appOrigin } from "@/lib/site-links";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-gutter py-24 sm:px-6">
      <h1 className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold">
        This page does not exist
      </h1>
      <p className="max-w-[60ch] text-muted-foreground">
        If you were opening something in your Tendnote, it lives in the app.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/">Go to the home page</Link>
        </Button>
        <Button asChild variant="outline">
          <a href={appOrigin()}>Open the app</a>
        </Button>
      </div>
    </div>
  );
}
