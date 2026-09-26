// Installed only in the throwaway eval app and its subprocesses.
const originalFetch = globalThis.fetch;
const proxy = process.env.TENDNOTE_COST_PROXY;
if (!proxy || !process.env.TENDNOTE_COST_PROXY_TOKEN) throw new Error("Missing cost replay proxy");
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin === "https://ai-gateway.vercel.sh") return forwardGateway(request, url);
  if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && url.protocol === "http:")
    return originalFetch(request);
  throw new Error(`Cost replay blocked external fetch to ${url.hostname}`);
};
async function forwardGateway(request, url) {
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.set("x-cost-proxy-token", process.env.TENDNOTE_COST_PROXY_TOKEN);
  return originalFetch(`${proxy}${url.pathname}`, {
    method: request.method,
    headers,
    body: request.method === "GET" ? undefined : await request.text(),
    signal: request.signal,
    redirect: "error",
  });
}
