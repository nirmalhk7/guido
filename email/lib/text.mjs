// The plain-text version: same content as the HTML, in the same order.

function wrapList(items, bullet = "- ") {
  return items.map((i) => `${bullet}${i}`).join("\n");
}

function cardText(c, m) {
  const lines = [
    `[${c.pill}] ${c.company}: ${c.total}${c.hasPrice ? ` ${c.totalCaption}` : ""}`,
    c.car,
    c.branchLine,
    ...(c.why ? [c.why] : []),
    ...(c.tags.length ? [c.tags.join(" · ")] : []),
    ...c.facts,
    ...(c.checked ? [c.checked] : []),
  ];
  if (c.recommended) lines.push("", `${m.button.label}: ${m.links.confirm_url}`, m.button.note);
  return lines.join("\n");
}

export function renderText(m) {
  const out = [m.brand.name, "", m.headline];
  if (m.intro) out.push(m.intro);
  if (m.envNotice) out.push("", `Note: ${m.envNotice}`);
  if (m.source?.stale) out.push(`Note: ${m.source.stale}`);

  out.push("", m.trip.heading.toUpperCase(), ...m.trip.rows.map((r) => `${r.label}: ${r.value}`));
  if (m.trip.rankedBy) out.push(m.trip.rankedBy);

  if (m.kind === "results") {
    if (m.recommended) out.push("", cardText(m.recommended, m));
    if (m.alternatives.length) {
      out.push("", m.alternativesHeading.toUpperCase());
      for (const a of m.alternatives) out.push("", cardText(a, m));
    }
    out.push("");
    if (m.notAFitLine) out.push(m.notAFitLine);
    out.push(`${m.seeAll}: ${m.links.audit_url}`);
  } else {
    const e = m.empty;
    out.push("", e.heading, "", `${e.searchedHeading}: ${e.searched}`, "", `${e.whyHeading}: ${e.why}`);
    if (e.list.length) out.push(wrapList(e.list.map((i) => `${i.company}: ${i.reason}`)));
    if (e.more) out.push(`- ${e.more}`);
    out.push("", `${e.changeHeading}:`, wrapList(e.suggestions), "", e.reply, `${e.link}: ${m.links.audit_url}`);
  }

  if (m.coverage) out.push("", m.coverage.line, ...m.coverage.missing, ...(m.coverage.note ? [m.coverage.note] : []));
  if (m.kind === "results") out.push("", m.reply.line);
  out.push(m.reply.address);
  if (m.source) out.push("", `${m.source.heading}:`, m.source.line, ...m.source.plain);
  out.push("", "--", ...m.footer);
  return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}
