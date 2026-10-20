import type { Config } from "./config.ts";

export const PHASES = ["landing", "open", "voting", "closed", "results"] as const;
export type Phase = (typeof PHASES)[number];

export const isPhase = (v: unknown): v is Phase => PHASES.includes(v as Phase);

/** Clock-driven phase; a valid admin override wins. Results only appear once published. */
export function computePhase(
  now: Date,
  cfg: Pick<Config, "openAt" | "submitCloseAt" | "voteCloseAt">,
  override: string | null,
  resultsPublished: boolean,
): Phase {
  if (isPhase(override)) return override;
  if (now < cfg.openAt) return "landing";
  if (now < cfg.submitCloseAt) return "open";
  if (now < cfg.voteCloseAt) return "voting";
  return resultsPublished ? "results" : "closed";
}
