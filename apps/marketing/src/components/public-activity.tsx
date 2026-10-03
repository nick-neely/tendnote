"use client";

import type { PublicActivityEvent, PublicPage } from "@tendnote/domain/public-activity";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef } from "react";

/*
 * Anonymous public activity (#646): page views, the demo's start and end, and
 * Subscribe clicks, each reported as one fixed event and one fixed page name.
 * The report carries no cookie, no identifier, no URL, and no referrer, and
 * nothing is stored in the browser. The product app counts it only for known-US
 * requests, as a daily total.
 */

/** Every approved public page's path. Any other path, a 404 included, is never counted. */
const PATH_BY_PAGE: Record<PublicPage, string> = {
  home: "/",
  product: "/product",
  demo: "/demo",
  pricing: "/pricing",
  about: "/about",
  privacy_and_ai: "/privacy-and-ai",
  support: "/support",
  fair_use: "/fair-use",
  terms: "/terms",
  privacy: "/privacy",
};

const PAGE_BY_PATH = new Map(
  Object.entries(PATH_BY_PAGE).map(([page, path]) => [path, page as PublicPage]),
);

type Report = (event: PublicActivityEvent, page: PublicPage) => void;

const ReportContext = createContext<Report>(() => {});

function send(endpoint: string, event: PublicActivityEvent, page: PublicPage) {
  // No credentials, so a signed-in visitor's app cookie never rides along, and
  // no referrer, so the page's URL is never sent. `keepalive` lets a report
  // made as a Subscribe click navigates away still arrive. The answer is
  // always empty, so it is never read.
  void fetch(endpoint, {
    method: "POST",
    body: JSON.stringify({ event, page }),
    credentials: "omit",
    keepalive: true,
    mode: "no-cors",
    referrerPolicy: "no-referrer",
  }).catch(() => {});
}

/**
 * Reports a view of each approved page and each activation of the signup link.
 * With no endpoint, it reports nothing.
 */
export function PublicActivity({
  children,
  endpoint,
  signupHref,
}: {
  children: React.ReactNode;
  endpoint: string | undefined;
  signupHref: string;
}) {
  const pathname = usePathname();
  const lastViewed = useRef<string | null>(null);

  const report = useCallback<Report>(
    (event, page) => {
      if (endpoint) send(endpoint, event, page);
    },
    [endpoint],
  );

  useEffect(() => {
    // Once per arrival at a page; a re-run for the same path is not a new view.
    if (lastViewed.current === pathname) return;
    lastViewed.current = pathname;
    const page = PAGE_BY_PATH.get(pathname);
    if (page) report("page_viewed", page);
  }, [pathname, report]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      const page = PAGE_BY_PATH.get(window.location.pathname);
      if (link?.getAttribute("href") === signupHref && page) report("signup_clicked", page);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [report, signupHref]);

  return <ReportContext value={report}>{children}</ReportContext>;
}

/** Report one public event, such as the demo starting. A no-op outside {@link PublicActivity}. */
export function usePublicActivity(): Report {
  return useContext(ReportContext);
}
