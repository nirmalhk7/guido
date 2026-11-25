import type { Browser, BrowserContext } from "playwright";
import { catalogSchema, quoteSchema, ToolReadError, type Tool } from "./contracts.ts";

const bodyLimit = 512 * 1024;
const pageTimeout = 7_000;

export function publicReadUrl(value: string) {
  const url = new URL(value);
  const local = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((!local && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) {
    throw new Error("Playwright endpoints require HTTPS, or loopback HTTP for testing, with no credentials, query, or fragment.");
  }
  if (/(?:^|[/_-])(?:sign[-_]?in|log[-_]?in|checkout|payment|reservations?|booking)(?:[/_.-]|$)/i.test(decodeURIComponent(url.pathname))) {
    throw new Error("Configure only catalog and quote-shopping endpoints.");
  }
  return url;
}

export function playwrightTool(options: { catalogUrl: string; quoteUrl: string; executablePath?: string }): Tool {
  const catalogUrl = publicReadUrl(options.catalogUrl);
  const quoteUrl = publicReadUrl(options.quoteUrl);
  let browser: Promise<Browser> | undefined;
  let context: Promise<BrowserContext> | undefined;
  let closed = false;

  function getContext() {
    if (closed) throw new ToolReadError("The browser search has ended.");
    if (!context) {
      browser = import("playwright").then(({ chromium }) => chromium.launch({
        headless: true,
        executablePath: options.executablePath,
        timeout: pageTimeout,
      }));
      context = browser.then((browser) => browser.newContext({
        javaScriptEnabled: false,
        acceptDownloads: false,
        serviceWorkers: "block",
      }));
    }
    return context;
  }

  async function read(endpoint: URL, params: Record<string, string>, signal: AbortSignal) {
    const target = new URL(endpoint);
    target.search = new URLSearchParams(params).toString();
    const page = await getContext().catch(() => {
      throw new ToolReadError("Chromium is unavailable. Install Playwright Chromium or configure its executable.");
    }).then((context) => {
      signal.throwIfAborted();
      return context.newPage();
    });
    const stop = () => { void page.close().catch(() => {}); };
    signal.addEventListener("abort", stop, { once: true });
    try {
      signal.throwIfAborted();
      let status = 0;
      let obstruction: string | undefined;
      await page.route("**/*", async (route) => {
        const request = route.request();
        if (request.url() !== target.href || request.method() !== "GET" || !request.isNavigationRequest()
          || request.frame() !== page.mainFrame()) {
          await route.abort();
          return;
        }
        try {
          // Fetch the single allowed document without following redirects. Render just its body in Chromium.
          const response = await route.fetch({ maxRedirects: 0, timeout: pageTimeout });
          try {
            status = response.status();
            const headers = response.headers();
            const contentType = headers["content-type"]?.split(";")[0].trim().toLowerCase();
            if ([401, 403, 429, 451].includes(status) || headers["cf-mitigated"] === "challenge") {
              obstruction = "The supplier blocked automated access or requires sign-in.";
            } else if (status >= 300 && status < 400) {
              obstruction = "The supplier redirected the request.";
            } else if (status !== 200 || contentType !== "application/json" && contentType !== "text/html") {
              obstruction = status !== 200 ? `The supplier responded with HTTP ${status}.`
                : "The source did not return a supported quote or catalog document.";
            } else if (Number(headers["content-length"]) > bodyLimit) {
              obstruction = "The supplier document exceeds the size limit.";
            } else {
              const body = await response.body();
              if (body.length <= bodyLimit) {
                await route.fulfill({
                  status: 200,
                  contentType: `${contentType}; charset=utf-8`,
                  headers: { "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" },
                  body,
                });
                return;
              }
              obstruction = "The supplier document exceeds the size limit.";
            }
          } finally {
            await response.dispose();
          }
        } catch {
          obstruction ??= "The supplier document could not be fetched.";
        }
        await route.fulfill({ status: 502, body: "" }).catch(() => {});
      });
      const response = await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: pageTimeout });
      if (obstruction) throw new ToolReadError(obstruction);
      if (!response?.ok()) throw new ToolReadError("The supplier document could not be opened.");
      const title = await page.title();
      if (/captcha|access denied|verify (you|your)|just a moment|sign in/i.test(title)) {
        throw new ToolReadError("The supplier blocked automated access or requires sign-in.");
      }
      const json = await page.evaluate(() => {
        const payload = document.querySelector('script#guido-data[type="application/json"]');
        if (payload) return payload.textContent;
        return document.contentType === "application/json" ? document.body.textContent : null;
      });
      if (json) return JSON.parse(json);
      throw new ToolReadError("The supplier page did not publish quote or catalog data.");
    } finally {
      signal.removeEventListener("abort", stop);
      await page.close().catch(() => {});
    }
  }

  return {
    async listBranches({ area, currency }, signal) {
      return catalogSchema.parse(await read(catalogUrl, { area, currency }, signal));
    },
    async quote(input, signal) {
      const params = Object.fromEntries(Object.entries(input)
        .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
        .map(([key, value]) => [key, String(value)]));
      const quote = quoteSchema.parse(await read(quoteUrl, params, signal));
      if (quote.status !== "available") return quote;
      return {
        ...quote,
        offers: quote.offers.map(({ sourceUrl, ...offer }) => {
          const url = sourceUrl ? new URL(sourceUrl) : new URL(quoteUrl);
          url.search = "";
          url.hash = "";
          let evidence = quoteUrl.href;
          if (url.origin === quoteUrl.origin) {
            try {
              evidence = publicReadUrl(url.href).href;
            } catch {
              // Quote pages sometimes return a reservation link where a source URL was expected.
            }
          }
          return { ...offer, sourceUrl: evidence };
        }),
      };
    },
    async close() {
      closed = true;
      if (browser) await browser.then((instance) => instance.close()).catch(() => {});
    },
  };
}
