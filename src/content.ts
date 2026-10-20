import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Lang } from "./i18n.ts";
import { renderMarkdown } from "./markdown.ts";

/**
 * Organizer-supplied rules, read on every request so edits to content/rules.<lang>.md
 * show up without a restart. Missing file → empty string (the page still renders).
 */
export function loadRules(dir: string, lang: Lang): string {
  try {
    return renderMarkdown(readFileSync(join(dir, `rules.${lang}.md`), "utf8"));
  } catch {
    return "";
  }
}
