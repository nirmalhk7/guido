// Email-safe HTML: tables for layout, inline styles, 600px wide, stacks on
// phones. Colors and sizes mirror the web UI's tokens (frontend/src/index.css).
import { esc } from "./format.mjs";

const T = {
  brand: "#1e4fd8", // the single accent
  brandStrong: "#173fad",
  brandSoft: "#ebf0fc",
  bg: "#f5f5f7",
  card: "#ffffff",
  text: "#1d1d1f",
  muted: "#5f5f66",
  border: "#e3e3e8",
  warnText: "#8a5300",
  warnBg: "#fff4e0",
  radius: "14px",
  font: "-apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
};

const p = (text, style = "") =>
  `<p style="margin:0;font-family:${T.font};font-size:16px;line-height:1.5;color:${T.text};${style}">${text}</p>`;

const pill = (text, kind) => {
  const styles = {
    primary: `background:${T.brand};color:#ffffff;font-weight:600;`,
    soft: `background:${T.brandSoft};color:${T.brandStrong};font-weight:600;`,
    tag: `background:${T.brandSoft};color:${T.brandStrong};font-weight:500;`,
  }[kind];
  return `<span style="display:inline-block;margin:0 4px 6px 0;padding:4px 10px;border-radius:999px;font-family:${T.font};font-size:13px;line-height:16px;${styles}">${esc(text)}</span>`;
};

/** A white rounded box with a 1px border (square corners in Outlook are fine). */
const box = (inner, { border = `1px solid ${T.border}`, padding = "20px", bg = T.card } = {}) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;background:${bg};border:${border};border-radius:${T.radius};">
  <tr><td class="box-pad" style="padding:${padding};">${inner}</td></tr>
</table>`;

const spacer = (h) => `<div style="height:${h}px;line-height:${h}px;font-size:1px;">&nbsp;</div>`;

function logo(m, logoUrl, size) {
  const word = `<span style="font-family:${T.font};font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.02em;color:${T.brand};">${esc(m.brand.name)}</span>`;
  if (!logoUrl) return word;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td valign="middle" style="padding-right:8px;"><img src="${esc(logoUrl)}" width="${size}" height="${size}" alt="${esc(m.brand.alt)}" style="display:block;width:${size}px;height:${size}px;border:0;outline:none;text-decoration:none;" /></td>
    <td valign="middle">${word}</td>
  </tr></table>`;
}

function button(label, href) {
  return `<table role="presentation" class="btn-full" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
  <tr><td align="center" bgcolor="${T.brand}" style="border-radius:999px;background:${T.brand};">
    <a href="${href}" style="display:inline-block;padding:14px 28px;font-family:${T.font};font-size:17px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">${esc(label)}</a>
  </td></tr>
</table>`;
}

function optionCard(c, m) {
  const left = [
    pill(c.pill, c.recommended ? "primary" : "soft"),
    `<p style="margin:4px 0 0;font-family:${T.font};font-size:${c.recommended ? 20 : 18}px;line-height:1.3;font-weight:600;color:${T.text};">${esc(c.company)}</p>`,
    `<p style="margin:2px 0 0;font-family:${T.font};font-size:15px;line-height:1.4;color:${T.muted};">${esc(c.car)}</p>`,
    `<p style="margin:6px 0 0;font-family:${T.font};font-size:15px;line-height:1.4;color:${T.text};">${esc(c.branchLine)}</p>`,
    c.why ? `<p style="margin:10px 0 0;font-family:${T.font};font-size:16px;line-height:1.45;color:${T.text};">${esc(c.why)}</p>` : "",
    c.tags.length ? `<div style="margin-top:10px;font-size:0;line-height:0;">${c.tags.map((t) => pill(t, "tag")).join("")}</div>` : "",
  ].join("");

  const priceSize = c.hasPrice ? (c.recommended ? 32 : 24) : 15;
  const right = `
    <p class="price-big" style="margin:0;font-family:${T.font};font-size:${priceSize}px;line-height:1.1;font-weight:${c.hasPrice ? 600 : 500};letter-spacing:-0.01em;color:${c.hasPrice ? T.text : T.muted};white-space:nowrap;">${esc(c.total)}</p>
    ${c.hasPrice ? `<p style="margin:4px 0 0;font-family:${T.font};font-size:13px;line-height:1.3;color:${T.muted};">${esc(c.totalCaption)}</p>` : ""}`;

  const facts = c.facts
    .map((f) => `<p style="margin:0 0 2px;font-family:${T.font};font-size:14px;line-height:1.45;color:${T.muted};">${esc(f)}</p>`)
    .join("");
  const checked = c.checked
    ? `<p style="margin:8px 0 0;font-family:${T.font};font-size:13px;line-height:1.4;color:${c.stale ? T.warnText : T.muted};">${c.stale ? "&#9888;&#xFE0E; " : ""}${esc(c.checked)}</p>`
    : "";

  const inner = `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td class="stack" valign="top" style="padding-right:16px;">${left}</td>
      <td class="stack price-col" valign="top" align="right" width="150" style="width:150px;text-align:right;">${right}</td>
    </tr>
  </table>
  <div style="margin-top:14px;padding-top:12px;border-top:1px solid ${T.border};">${facts}${checked}</div>
  ${
    c.recommended
      ? `${spacer(16)}${button(m.button.label, m.links.confirm_url)}
         <p style="margin:10px 0 0;font-family:${T.font};font-size:13px;line-height:1.45;color:${T.muted};">${esc(m.button.note)}</p>`
      : ""
  }`;
  return box(inner, { border: c.recommended ? `2px solid ${T.brand}` : `1px solid ${T.border}` });
}

function tripRecap(m) {
  const rows = m.trip.rows
    .map(
      (r) => `<tr>
      <td class="trip-label" valign="top" width="128" style="width:128px;padding:6px 12px 6px 0;font-family:${T.font};font-size:14px;line-height:1.45;color:${T.muted};">${esc(r.label)}</td>
      <td valign="top" style="padding:6px 0;font-family:${T.font};font-size:15px;line-height:1.45;color:${T.text};">${esc(r.value)}</td>
    </tr>`,
    )
    .join("");
  return box(`
    <p style="margin:0 0 6px;font-family:${T.font};font-size:13px;line-height:1.3;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${T.muted};">${esc(m.trip.heading)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
    ${m.trip.rankedBy ? `<div style="margin-top:10px;font-size:0;line-height:0;">${pill(m.trip.rankedBy, "soft")}</div>` : ""}`);
}

function notice(text, tone = "neutral") {
  const s = tone === "warn" ? `background:${T.warnBg};color:${T.warnText};border:1px solid ${T.warnBg};` : `background:${T.card};color:${T.text};border:1px solid ${T.border};`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-radius:12px;${s}">
    <tr><td style="padding:12px 16px;font-family:${T.font};font-size:15px;line-height:1.45;">${esc(text)}</td></tr>
  </table>`;
}

function emptyBlock(m) {
  const e = m.empty;
  const h3 = (t) => `<p style="margin:18px 0 4px;font-family:${T.font};font-size:13px;line-height:1.3;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${T.muted};">${esc(t)}</p>`;
  const list = e.list.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;border-collapse:separate;background:${T.bg};border-radius:10px;">
        ${e.list
          .map(
            (i) => `<tr><td style="padding:10px 14px;border-bottom:1px solid ${T.border};font-family:${T.font};font-size:15px;line-height:1.45;color:${T.text};">
              <strong style="font-weight:600;">${esc(i.company)}</strong><br /><span style="color:${T.muted};">${esc(i.reason)}</span></td></tr>`,
          )
          .join("")}
        ${e.more ? `<tr><td style="padding:10px 14px;font-family:${T.font};font-size:14px;color:${T.muted};">${esc(e.more)}</td></tr>` : ""}
      </table>`
    : "";
  const suggestions = `<ul style="margin:4px 0 0;padding:0 0 0 20px;">${e.suggestions
    .map((s) => `<li style="margin:0 0 4px;font-family:${T.font};font-size:16px;line-height:1.45;color:${T.text};">${esc(s)}</li>`)
    .join("")}</ul>`;
  return box(`
    <p style="margin:0;font-family:${T.font};font-size:20px;line-height:1.35;font-weight:600;color:${T.text};">${esc(e.heading)}</p>
    ${h3(e.searchedHeading)}${p(esc(e.searched))}
    ${h3(e.whyHeading)}${p(esc(e.why))}${list}
    ${h3(e.changeHeading)}${suggestions}
    <div style="margin-top:18px;padding:14px 16px;background:${T.brandSoft};border-radius:10px;">
      ${p(`<strong style="font-weight:600;color:${T.brandStrong};">${esc(e.reply)}</strong>`)}
    </div>
    <p style="margin:14px 0 0;font-family:${T.font};font-size:15px;"><a href="${m.links.audit_url}" style="color:${T.brand};font-weight:600;text-decoration:none;">${esc(e.link)} &rarr;</a></p>`);
}

export function renderHtml(m, { logoUrl = "", logoSize = 28 } = {}) {
  const sections = [];
  sections.push(`<tr><td style="padding:0 4px 20px;">${logo(m, logoUrl, logoSize)}</td></tr>`);
  sections.push(`<tr><td style="padding:0 4px;">
    <h1 class="h1" style="margin:0;font-family:${T.font};font-size:26px;line-height:1.25;font-weight:700;letter-spacing:-0.01em;color:${T.text};">${esc(m.headline)}</h1>
    ${m.intro ? `<p style="margin:8px 0 0;font-family:${T.font};font-size:16px;line-height:1.5;color:${T.muted};">${esc(m.intro)}</p>` : ""}
  </td></tr>`);
  if (m.envNotice) sections.push(`<tr><td style="padding:16px 0 0;">${notice(m.envNotice)}</td></tr>`);
  if (m.source?.stale) sections.push(`<tr><td style="padding:8px 0 0;">${notice(m.source.stale, "warn")}</td></tr>`);
  sections.push(`<tr><td style="padding:20px 0 0;">${tripRecap(m)}</td></tr>`);

  if (m.kind === "results") {
    if (m.recommended) sections.push(`<tr><td style="padding:16px 0 0;">${optionCard(m.recommended, m)}</td></tr>`);
    if (m.alternatives.length) {
      sections.push(`<tr><td style="padding:28px 4px 4px;"><p style="margin:0;font-family:${T.font};font-size:20px;line-height:1.3;font-weight:600;color:${T.text};">${esc(m.alternativesHeading)}</p></td></tr>`);
      for (const a of m.alternatives) sections.push(`<tr><td style="padding:12px 0 0;">${optionCard(a, m)}</td></tr>`);
    }
    sections.push(`<tr><td style="padding:18px 4px 0;">
      ${m.notAFitLine ? `<p style="margin:0 0 8px;font-family:${T.font};font-size:15px;line-height:1.45;color:${T.muted};">${esc(m.notAFitLine)}</p>` : ""}
      <a href="${m.links.audit_url}" style="font-family:${T.font};font-size:16px;font-weight:600;color:${T.brand};text-decoration:none;">${esc(m.seeAll)} &rarr;</a>
    </td></tr>`);
  } else {
    sections.push(`<tr><td style="padding:16px 0 0;">${emptyBlock(m)}</td></tr>`);
  }

  if (m.coverage) {
    sections.push(`<tr><td style="padding:24px 4px 0;">
      ${p(esc(m.coverage.line), `font-size:15px;font-weight:600;`)}
      ${m.coverage.missing.map((x) => p(esc(x), `font-size:15px;color:${T.muted};margin-top:2px;`)).join("")}
      ${m.coverage.note ? p(esc(m.coverage.note), `font-size:13px;color:${T.muted};margin-top:4px;`) : ""}
    </td></tr>`);
  }

  if (m.kind === "results") {
    sections.push(`<tr><td style="padding:20px 0 0;">${box(
      `${p(esc(m.reply.line), "font-weight:600;")}${p(esc(m.reply.address), `font-size:14px;color:${T.muted};margin-top:4px;`)}`,
      { bg: T.brandSoft, border: `1px solid ${T.brandSoft}`, padding: "16px 18px" },
    )}</td></tr>`);
  } else {
    sections.push(`<tr><td style="padding:16px 4px 0;">${p(esc(m.reply.address), `font-size:14px;color:${T.muted};`)}</td></tr>`);
  }

  if (m.source) {
    sections.push(`<tr><td style="padding:24px 4px 0;">
      <p style="margin:0 0 4px;font-family:${T.font};font-size:13px;line-height:1.3;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${T.muted};">${esc(m.source.heading)}</p>
      ${p(esc(m.source.line), `font-size:14px;color:${T.muted};`)}
      ${m.source.plain.map((x) => p(esc(x), `font-size:14px;color:${T.muted};`)).join("")}
    </td></tr>`);
  }

  sections.push(`<tr><td style="padding:28px 4px 0;"><div style="border-top:1px solid ${T.border};padding-top:16px;">
    ${m.footer.map((f, i) => p(esc(f), `font-size:13px;color:${T.muted};${i ? "margin-top:6px;" : ""}`)).join("")}
  </div></td></tr>`);

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${esc(m.subject)}</title>
<style>
  body { margin:0; padding:0; background:${T.bg}; -webkit-text-size-adjust:100%; }
  a { color:${T.brand}; }
  @media (max-width: 520px) {
    .outer-pad { padding:16px 12px !important; }
    .box-pad { padding:16px !important; }
    .stack { display:block !important; width:100% !important; padding-right:0 !important; }
    .price-col { text-align:left !important; padding-top:12px !important; }
    .btn-full { width:100% !important; }
    .btn-full a { display:block !important; }
    .h1 { font-size:23px !important; }
    .trip-label { width:96px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${T.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(m.preheader ?? "")}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${T.bg};">
  <tr><td align="center" class="outer-pad" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
      ${sections.join("\n")}
    </table>
  </td></tr>
</table>
</body>
</html>
`;
}
