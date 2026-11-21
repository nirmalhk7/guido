// Optional HTML version of Guido's reply (switch: HTML_EMAIL_ENABLED, default off).
// Guild fills a fixed set of named blanks ("email" in its JSON output). This file
// checks them and drops them into the designed layout from email/ (which escapes
// all text). Anything missing or odd → return null, and the caller sends the
// existing plain-text reply instead.
import { createRequire } from "node:module";
import { z } from "zod";
import { renderHtml } from "../email/lib/html.mjs";

const copy = createRequire(import.meta.url)("../contracts/display_fields.json");

const text = (max: number) => z.string().trim().min(1).max(max);
export const emailBlanks = z.strictObject({
  headline: text(120),
  trip_recap: z.array(z.strictObject({ label: text(24), value: text(120) })).min(1).max(6),
  options: z.array(z.strictObject({
    company: text(40),
    branch: text(80),
    tags: z.array(text(28)).max(3).default([]),
    total: text(24),
    recommended: z.boolean(),
    why: text(140).optional(),
  })).min(1).max(4),
  coverage: text(160),
  data_source: text(200),
});
export type EmailBlanks = z.infer<typeof emailBlanks>;

const LEFTOVER = /\{\{|\}\}|\{[a-z_]+\}|\bundefined\b|\bnull\b|\bNaN\b/i;

export function htmlEmailEnabled() {
  return /^(1|true|on|yes)$/i.test(process.env.HTML_EMAIL_ENABLED?.trim() ?? "");
}

/** HTML body from Guild's blanks, or null when anything is missing or suspicious. */
export function buildHtmlEmail(raw: unknown, replyTo: string): string | null {
  try {
    const parsed = emailBlanks.safeParse(raw);
    if (!parsed.success) return null;
    const b = parsed.data;
    if (LEFTOVER.test(JSON.stringify(b))) return null;
    if (b.options.filter((o) => o.recommended).length > 1) return null;

    const card = (o: EmailBlanks["options"][number]) => ({
      pill: o.recommended ? copy.status_labels.recommended : copy.status_labels.alternative,
      recommended: o.recommended,
      company: o.company,
      car: "",
      branchLine: o.branch,
      why: o.recommended ? o.why : undefined,
      tags: o.tags,
      total: o.total,
      hasPrice: true,
      totalCaption: copy.option_card.total_caption,
      facts: "",
      stale: false,
    });
    const rec = b.options.find((o) => o.recommended);
    const model = {
      kind: "results",
      subject: b.headline,
      preheader: b.headline,
      headline: b.headline,
      brand: { name: copy.page.brand_name, alt: copy.email.logo_alt },
      trip: { heading: copy.email.trip_heading, rows: b.trip_recap },
      recommended: rec ? card(rec) : null,
      alternatives: b.options.filter((o) => !o.recommended).map(card),
      alternativesHeading: copy.alternatives.heading,
      coverage: { line: b.coverage, missing: [] },
      reply: { line: copy.email.reply_line, address: copy.email.reply_address_line.replace("{reply_to_address}", replyTo) },
      source: { heading: copy.email.source_heading, line: b.data_source, plain: [] },
      button: { label: copy.email.review_button, note: copy.email.review_note },
      footer: [copy.email.footer_never_books, copy.confirmation.no_card_note, copy.email.footer_why],
      // No hosted web page yet, so no links: the layout leaves out the button and "See all".
      links: { confirm_url: "", audit_url: "", reply_to_address: replyTo },
    };
    const html = renderHtml(model, { logoUrl: process.env.EMAIL_LOGO_URL?.trim() ?? "" });
    const visible = html.replace(/<style[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, " ");
    return LEFTOVER.test(visible) ? null : html;
  } catch {
    return null;
  }
}
