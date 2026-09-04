import type { ReactNode } from "react";
import { AssistantPageFrame } from "@/components/assistant-page-frame";

export default function AssistantLayout({ children }: { children: ReactNode }) {
  return <AssistantPageFrame>{children}</AssistantPageFrame>;
}
