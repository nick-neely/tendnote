// Button lives in the shared UI package so the marketing app renders the same
// control. This path stays because the shadcn `ui` alias and the registry
// components that depend on Button import it from here.
export { Button, buttonVariants } from "@tendnote/ui/button";
