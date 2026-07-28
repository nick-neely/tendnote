import { serviceWorkerDestinationConfig } from "@/components/app-destinations";

/** Public, non-owner configuration consumed by the installed service worker. */
export function GET() {
  return Response.json(serviceWorkerDestinationConfig, {
    headers: { "cache-control": "public, max-age=0, must-revalidate" },
  });
}
