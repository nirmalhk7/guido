// Renders every email preview into email/out/: one .html and one .txt each,
// plus out/index.html to look at them all in a browser.
//
//   cd email && npm run render:email
//   open out/index.html
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { renderEmail, defaultConfig } from "./template.mjs";
import { variants, sentAtFor } from "./samples/variants.mjs";

const OUT = new URL("./out/", import.meta.url);
const STRESS = new URL("./samples/stress/", import.meta.url);

// Which demo variants to render, in order.
const VARIANT_ORDER = ["normal"];

const jobs = VARIANT_ORDER.filter((k) => variants[k]).map((k) => {
  const v = variants[k]();
  return { name: k, title: v.title, result: v.result, sentAt: v.sentAt ?? sentAtFor(v.result), group: "Variants" };
});

if (existsSync(STRESS)) {
  for (const file of readdirSync(STRESS).filter((f) => f.endsWith(".json")).sort()) {
    const data = JSON.parse(readFileSync(new URL(file, STRESS), "utf8"));
    const result = data.result ?? data;
    jobs.push({ name: `stress-${file.replace(/\.json$/, "")}`, title: data._title ?? file, result, sentAt: sentAtFor(result ?? {}), group: "Stress tests" });
  }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Words that must never reach a reader.
const FORBIDDEN = /\b(undefined|null|NaN)\b|(?<!\{)\{[a-z_]+\}(?!\})/;
const problems = [];

for (const job of jobs) {
  const { subject, html, text, kind } = renderEmail(job.result, { sentAt: job.sentAt });
  writeFileSync(new URL(`${job.name}.html`, OUT), html);
  writeFileSync(new URL(`${job.name}.txt`, OUT), `Subject: ${subject}\n\n${text}`);
  job.subject = subject;
  job.kind = kind;
  const visible = html.replace(/<style[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, " ");
  for (const [where, body] of [["html", visible], ["txt", text], ["subject", subject]]) {
    const m = body.match(FORBIDDEN);
    if (m) problems.push(`${job.name} (${where}): "${m[0]}"`);
  }
}

// One extra preview with the logo image, using the local copy (emails need a public URL).
const logoJob = jobs.find((j) => j.name === "normal");
if (logoJob) {
  const { html } = renderEmail(logoJob.result, { sentAt: logoJob.sentAt, logoUrl: defaultConfig.preview_logo_path });
  writeFileSync(new URL("normal--with-logo.html", OUT), html);
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const groups = [...new Set(jobs.map((j) => j.group))];
const nav = groups
  .map(
    (g) => `<h2>${g}</h2><ul>${jobs
      .filter((j) => j.group === g)
      .map((j) => `<li><a href="#${j.name}">${esc(j.title)}</a></li>`)
      .join("")}${g === "Variants" && logoJob ? `<li><a href="#normal--with-logo">Normal results, with logo image</a></li>` : ""}</ul>`,
  )
  .join("");
const all = [...jobs];
if (logoJob) all.splice(1, 0, { name: "normal--with-logo", title: "Normal results, with logo image", subject: logoJob.subject, kind: logoJob.kind });
const panels = all
  .map(
    (j) => `<section id="${j.name}">
  <h3>${esc(j.title)}</h3>
  <p class="meta"><strong>Subject:</strong> ${esc(j.subject)} · <a href="${j.name}.html" target="_blank">open HTML</a>${
      existsSync(new URL(`${j.name}.txt`, OUT)) ? ` · <a href="${j.name}.txt" target="_blank">plain text</a>` : ""
    }</p>
  <div class="frames">
    <figure><figcaption>Desktop (600px)</figcaption><iframe src="${j.name}.html" style="width:680px" loading="lazy" title="${esc(j.title)} desktop"></iframe></figure>
    <figure><figcaption>Phone (375px)</figcaption><iframe src="${j.name}.html" style="width:375px" loading="lazy" title="${esc(j.title)} phone"></iframe></figure>
  </div>
</section>`,
  )
  .join("\n");

writeFileSync(
  new URL("index.html", OUT),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Guido email previews</title>
<style>
body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:#e9e9ee;color:#1d1d1f;display:flex}
nav{position:sticky;top:0;height:100vh;overflow:auto;width:230px;flex:none;padding:20px;background:#fff;border-right:1px solid #ddd;box-sizing:border-box}
nav h1{font-size:18px;margin:0 0 4px} nav h2{font-size:12px;text-transform:uppercase;color:#666;margin:18px 0 6px} nav ul{list-style:none;padding:0;margin:0} nav a{display:block;padding:5px 0;color:#1e4fd8;text-decoration:none;font-size:14px}
main{flex:1;padding:24px;min-width:0} section{margin-bottom:48px} h3{margin:0 0 4px;font-size:20px} .meta{margin:0 0 12px;font-size:13px;color:#555} .meta a{color:#1e4fd8}
.frames{display:flex;gap:24px;align-items:flex-start;overflow-x:auto} figure{margin:0} figcaption{font-size:12px;color:#666;margin-bottom:6px}
iframe{height:1400px;border:1px solid #ccc;border-radius:10px;background:#fff}
</style></head><body>
<nav><h1>Guido emails</h1><p style="font-size:12px;color:#666;margin:0">Rendered ${new Date().toLocaleString()}</p>${nav}</nav>
<main>${panels}</main></body></html>`,
);

console.log(`Rendered ${jobs.length} emails to email/out/ (open email/out/index.html to preview).`);
if (problems.length) {
  console.error(`\n⚠️  ${problems.length} problem(s): words a reader should never see:\n  ${problems.join("\n  ")}`);
  process.exitCode = 1;
} else {
  console.log("Checked: no 'undefined', 'null', 'NaN' or unfilled {placeholders} in any email.");
}
