"use client";

import { useRouter } from "next/navigation";
import { AssistantPageHeader } from "@/components/assistant-page-header";
import {
  AssistantComposerShell,
  AssistantPageGreeting,
  AssistantResumeSkeleton,
} from "@/components/assistant-panel-chrome";
import { AssistantStarterChips } from "@/components/assistant-starter-chips";
import { NotebookPenIcon } from "@/components/icons";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

/** Owner-neutral chrome uses the live rail's provider, so streaming cannot reset its fold. */
export function AssistantPageReserve({ newConversation = false }: { newConversation?: boolean }) {
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  function startNewConversation() {
    setOpenMobile(false);
    router.push("/assistant");
  }
  return (
    <>
      <Sidebar
        className="top-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] h-auto lg:top-[calc(3.5rem+1px)] lg:bottom-0 lg:data-[side=left]:left-(--tn-canvas-rail)"
        collapsible="icon"
      >
        <nav
          aria-label="Conversations"
          className="flex h-full min-h-0 flex-col pt-[env(safe-area-inset-top)]"
        >
          <SidebarHeader className="gap-1">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="h-9 text-primary hover:bg-primary/10 hover:text-primary"
                  onClick={startNewConversation}
                  tooltip="New conversation"
                >
                  <NotebookPenIcon aria-hidden />
                  <span>New conversation</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent
            aria-busy="true"
            aria-label="Loading conversations"
            className="group-data-[collapsible=icon]:hidden"
          >
            <div aria-hidden className="flex flex-col gap-2 px-4 pt-3">
              <div className="h-4 w-[7ch] animate-pulse rounded bg-muted" />
              <div className="h-7 w-full animate-pulse rounded bg-muted/60" />
            </div>
          </SidebarContent>
        </nav>
      </Sidebar>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AssistantPageHeader onNewConversation={startNewConversation} title={null} />
        <div className="mx-auto flex min-h-0 w-full max-w-[52rem] flex-1 flex-col px-gutter sm:px-6">
          <AssistantPageTranscriptReserve newConversation={newConversation} />
        </div>
      </div>
    </>
  );
}

/** Only an existing thread reserves messages; a fresh page already knows its opening copy. */
export function AssistantPageTranscriptReserve({
  newConversation = false,
}: {
  newConversation?: boolean;
}) {
  return (
    <>
      <div aria-hidden className="min-h-0 flex-1">
        {newConversation ? null : <AssistantResumeSkeleton />}
      </div>
      {newConversation ? <AssistantPageGreeting /> : null}
      <AssistantComposerShell surface="page">
        <section
          aria-busy="true"
          aria-label="Loading composer"
          className="min-h-28 w-full rounded-lg border border-input"
        />
        {newConversation ? (
          <div className="pt-3">
            <AssistantStarterChips disabled />
          </div>
        ) : null}
      </AssistantComposerShell>
      {newConversation ? <div aria-hidden className="min-h-0 flex-1" /> : null}
    </>
  );
}
