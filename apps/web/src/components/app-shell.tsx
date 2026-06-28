import { BookUserIcon, CircleUserRoundIcon, HomeIcon, MessageSquareTextIcon } from "lucide-react";
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
          <nav className="flex items-center gap-1">
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
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
        {children}
      </main>
      <Separator />
    </div>
  );
}
