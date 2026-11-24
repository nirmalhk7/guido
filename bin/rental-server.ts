import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { extname } from "node:path";
import { POST } from "../lib/rental/http.ts";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
const dist = new URL("../frontend/dist/", import.meta.url);
const media = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"], [".svg", "image/svg+xml"], [".png", "image/png"],
]);
const maxActiveSearches = 2;
let activeSearches = 0;

const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url ?? "/", `http://localhost:${port}`);
    if (url.pathname === "/api/rental-search") {
      if (incoming.method !== "POST") return outgoing.writeHead(405, { Allow: "POST" }).end();
      if (activeSearches >= maxActiveSearches) {
        return outgoing.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "5" })
          .end(JSON.stringify({ error: "Guido is busy. Try again in a moment." }));
      }
      const controller = new AbortController();
      outgoing.once("close", () => controller.abort());
      activeSearches++;
      try {
        const request = new Request(url, {
          method: "POST", headers: incoming.headers, body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>, duplex: "half", signal: controller.signal,
        } as RequestInit & { duplex: "half" });
        const result = await POST(request);
        return outgoing.writeHead(result.status, Object.fromEntries(result.headers)).end(await result.text());
      } finally {
        activeSearches--;
      }
    }
    if (incoming.method !== "GET" && incoming.method !== "HEAD") return outgoing.writeHead(405, { Allow: "GET, HEAD" }).end();
    const path = url.pathname.slice(1);
    const file = ["", "search", "search/"].includes(path) ? "index.html"
      : /^(assets|brand)\/[a-zA-Z0-9._-]+\.(js|css|svg|png)$/.test(path) ? path : null;
    if (!file) return outgoing.writeHead(404).end();
    const body = await readFile(new URL(file, dist)).catch(() => null);
    if (!body) return outgoing.writeHead(file === "index.html" ? 503 : 404).end(file === "index.html"
      ? "Build the frontend with npm --prefix frontend run build." : undefined);
    outgoing.writeHead(200, {
      "Content-Type": media.get(extname(file))!,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    }).end(incoming.method === "HEAD" ? undefined : body);
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end();
  }
});
server.requestTimeout = 60_000;
server.listen(port, host, () => {
  const address = server.address();
  console.log(`Guido is listening on http://${host}:${typeof address === "object" && address ? address.port : port}/search`);
});
