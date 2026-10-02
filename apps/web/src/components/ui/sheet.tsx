// Sheet lives in the shared UI package so the marketing site's phone menu
// renders the same control. This path stays because the shadcn `ui` alias and
// the registry components that depend on Sheet (the sidebar) import it here.
export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@tendnote/ui/sheet";
