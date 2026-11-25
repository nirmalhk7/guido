import { once } from "node:events";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const browserEnabled = process.env.GUIDO_TEST_BROWSER === "1";

test("portable UI and Playwright compare each ordered pair against a controlled read-only source", {
  skip: !browserEnabled, timeout: 45_000,
}, async (t) => {
  const calls = [];
  const branches = ["san-mateo", "belmont", "sfo"].map((id, index) => ({
    id, name: ["San Mateo test branch", "Belmont test branch", "SFO test branch"][index],
    kind: index === 2 ? "airport" : "non_airport",
    centerToPickup: { minutes: 5 + index, costCents: 200 * index },
    returnToCenter: { minutes: 8 - index, costCents: 100 * index },
  }));
  const stub = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    calls.push({ path: url.pathname, method: req.method, params: Object.fromEntries(url.searchParams) });
    const respond = (data) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(data));
    if (url.pathname === "/catalog") {
      return res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><title>Synthetic catalog</title>
        <script id="guido-data" type="application/json">${JSON.stringify({ branches })}</script>
        <script>fetch('/checkout', {method: 'POST'});</script><iframe src="/payment"></iframe><img src="/sign-in">`);
    }
    if (url.pathname !== "/quotes") return res.writeHead(500).end("Unexpected route");
    const pair = `${url.searchParams.get("pickupId")}/${url.searchParams.get("returnId")}`;
    if (pair === "san-mateo/sfo") return res.writeHead(503).end();
    if (pair === "belmont/san-mateo") return res.writeHead(302, { location: "/sign-in" }).end();
    if (pair === "sfo/san-mateo") return res.writeHead(200, { "content-type": "text/html" }).end("<title>Verify your browser</title>");
    if (pair === "sfo/sfo") return respond({ status: "no_cars" });
    const base = pair === "belmont/sfo" ? 13000 : pair === "sfo/belmont" ? 19000 : 20000;
    return respond({
      status: "available",
      offers: [{
        id: "economy", vehicle: "Sample economy", carClass: "economy", currency: "USD", quotedAt: "2026-11-23T10:00:00Z",
        sourceUrl: `http://${req.headers.host}/checkout`,
        charges: { base, taxes: "included", airport: 0, oneWay: pair === "san-mateo/belmont" ? null : 0,
          youngDriver: 0, additionalDriver: 0, otherMandatory: 0 },
      }],
    });
  }).listen(0, "127.0.0.1");
  t.after(() => { stub.closeAllConnections(); stub.close(); });
  await once(stub, "listening");
  const stubOrigin = `http://127.0.0.1:${stub.address().port}`;

  const temp = await mkdtemp(join(tmpdir(), "guido-browser-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const config = join(temp, "providers.json");
  await writeFile(config, JSON.stringify([
    { id: "enterprise", name: "Controlled Quote Source", limits: { intervalMs: 0 }, sources: [{
      id: "chromium", kind: "playwright", catalogUrl: `${stubOrigin}/catalog`, quoteUrl: `${stubOrigin}/quotes`,
    }] },
  ]));
  const proc = spawn(process.execPath, ["bin/rental-server.ts"], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: "0", GUIDO_RENTAL_CONFIG: config },
    stdio: ["ignore", "pipe", "inherit"],
  });
  t.after(() => proc.kill());
  let startup = "";
  const baseUrl = await new Promise((resolve, reject) => {
    proc.once("error", reject);
    proc.once("exit", (code) => reject(new Error(`Guido exited with ${code}.`)));
    proc.stdout.on("data", (data) => {
      startup += data;
      const url = startup.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (url) resolve(url[0]);
    });
  });
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ executablePath: process.env.GUIDO_CHROMIUM_EXECUTABLE });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/search`);
  await page.getByRole("heading", { name: "Compare rental car branches" }).waitFor();
  await page.getByRole("button", { name: "Try sample trip" }).click();
  await page.getByRole("heading", { name: "San Mateo, Belmont and SFO" }).waitFor();
  await page.getByText("Recommended among checked offers").waitFor();
  assert.equal(calls.length, 0, "Offline fixtures must not contact the configured provider");

  await page.getByLabel("Pickup city or area").fill("San Mateo");
  await page.getByLabel("Pickup date and time").fill("2030-06-15T10:00");
  await page.getByLabel("Return date and time").fill("2030-06-18T11:00");
  await page.getByLabel("UTC offset").nth(0).fill("-07:00");
  await page.getByLabel("UTC offset").nth(1).fill("-07:00");
  const [response] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/rental-search")),
    page.getByRole("button", { name: "Search rental branches" }).click(),
  ]);
  assert.equal(response.status(), 200, await response.text());
  const result = await response.json();
  assert.equal(result.recommendation, "enterprise/belmont/sfo/economy");
  assert.equal(result.options[0].source.id, "chromium");
  assert.equal(result.options[0].source.url, `${stubOrigin}/quotes`);
  assert.equal(result.options[0].offer.quotedAt, "2026-11-23T10:00:00Z");
  const coverage = result.coverage.find(({ supplierId }) => supplierId === "enterprise");
  assert.deepEqual(result.coverage.filter(({ supplierId }) => supplierId !== "enterprise").map(({ status }) => status),
    ["unverified", "unverified"]);
  assert.equal(coverage.pairsChecked, 9);
  assert.equal(coverage.pairs.filter(({ status }) => status === "unavailable").length, 3);
  assert.equal(coverage.pairs.filter(({ status }) => status === "no_cars").length, 1);
  assert.equal(coverage.pairs.filter(({ status }) => status === "partial").length, 1);
  const quoteCalls = calls.filter(({ path }) => path === "/quotes");
  assert.equal(calls.length, 10);
  assert.equal(quoteCalls.length, 9);
  assert.ok(calls.every(({ method }) => method === "GET"));
  assert.deepEqual(calls.find(({ path }) => path === "/catalog").params, { area: "San Mateo", currency: "USD" });
  const expected = new Set(branches.flatMap(({ id }) => branches.map((dropoff) => `${id}/${dropoff.id}`)));
  for (const { params: { pickupId, returnId, ...input } } of quoteCalls) {
    assert.ok(expected.delete(`${pickupId}/${returnId}`), "Each ordered pair must be quoted exactly once");
    assert.deepEqual(input, {
      pickupAt: "2030-06-15T10:00:00-07:00", returnAt: "2030-06-18T11:00:00-07:00",
      currency: "USD", driverAge: "30", drivers: "1",
    });
  }
  assert.equal(expected.size, 0);

  await page.getByText("Controlled Quote Source · Partial coverage · 9/9 combinations attempted").click();
  await page.getByText("San Mateo test branch → SFO test branch · Unavailable").waitFor();
  await page.getByText("Price and quote details").first().click();
  await page.getByText("Quoted", { exact: false }).first().waitFor();
  await page.getByRole("link", { name: "Audit-trail demo" }).click();
  await page.getByRole("link", { name: "Search rentals" }).waitFor();
  assert.deepEqual(errors, []);
  assert.equal((await fetch(`${baseUrl}/api/book`, { method: "POST" })).status, 405);
});
