import type { ReactNode } from "react";
import { AdmittedFrame } from "@/components/admitted-frame";

/** One admission boundary survives navigation between the ledger and Assistant canvas. */
export default function MemberLayout({ children }: { children: ReactNode }) {
  return <AdmittedFrame>{children}</AdmittedFrame>;
}
