// Public entry point for the backend: one function, trip result in → email out.
//
//   import { renderEmail } from "./email/template.mjs";
//   const { subject, html, text } = renderEmail(tripResult);
//   // then replace {{audit_url}}, {{confirm_url}}, {{reply_to_address}} and send via AgentMail.
import { readFileSync } from "node:fs";
import { buildModel } from "./lib/model.mjs";
import { renderHtml } from "./lib/html.mjs";
import { renderText } from "./lib/text.mjs";

export const defaultConfig = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf8"));

/**
 * @param {object} result  A trip result matching contracts/trip_result.schema.json.
 * @param {{ sentAt?: number, logoUrl?: string, config?: object }} [options]
 *   sentAt: when the email is sent (ms). Used to say how old prices are. Defaults to now.
 *   logoUrl: overrides config.logo_url. Empty means text-only wordmark.
 */
export function renderEmail(result, options = {}) {
  const config = { ...defaultConfig, ...(options.config ?? {}) };
  const model = buildModel(result, { config, sentAt: options.sentAt });
  const logoUrl = options.logoUrl ?? config.logo_url ?? "";
  return {
    subject: model.subject,
    preheader: model.preheader ?? "",
    html: renderHtml(model, { logoUrl, logoSize: config.logo_size_px }),
    text: renderText(model),
    kind: model.kind,
  };
}
