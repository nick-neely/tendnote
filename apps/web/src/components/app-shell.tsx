import {
  BookmarkIcon,
  BookUserIcon,
  BoxIcon,
  CircleDotIcon,
  CircleUserRoundIcon,
  HomeIcon,
  MessageSquareTextIcon,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const navItems = [
  {
    href: "/",
    label: "Dashboard",
    icon: HomeIcon,
  },
  {
    href: "/people",
    label: "People",
    icon: BookUserIcon,
  },
  {
    href: "/actions",
    label: "Actions",
    icon: CircleDotIcon,
  },
  {
    href: "/assets",
    label: "Assets",
    icon: BoxIcon,
  },
  {
    href: "/saved-items",
    label: "Saved Items",
    icon: BookmarkIcon,
  },
  {
    href: "/account",
    label: "Account",
    icon: CircleUserRoundIcon,
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link className="flex items-center gap-2 font-semibold tracking-normal" href="/">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <MessageSquareTextIcon aria-hidden className="size-4" />
            </span>
            Tendnote
          </Link>
          <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => {
              const Icon = item.icon;

              return (
                <Button asChild key={item.href} variant="ghost">
                  <Link href={item.href}>
                    <Icon aria-hidden data-icon="inline-start" />
                    {item.label}
                  </Link>
                </Button>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pt-6 pb-24 sm:px-6 md:pb-6 lg:py-8">
        {children}
      </main>
      <Separator />
      <nav
        aria-label="Mobile primary"
        className="fixed bottom-0 z-20 grid w-full grid-cols-6 border-t bg-background/98 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              className="flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-1 text-[length:var(--text-caption)] text-muted-foreground transition-colors motion-reduce:transition-none hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
              href={item.href}
              key={item.href}
            >
              <Icon aria-hidden className="size-5" />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
