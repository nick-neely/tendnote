/**
 * Keeps protected routes together without performing request-bound work in a
 * layout. Next.js only permits that work inside the route loading boundary;
 * each page resolves admission before its owner-scoped content.
 */
export default function AdmittedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
