import type { GeminiModel, TaskKind } from "../types";
import { lookupCatalog } from "./catalog";
import { cooldownRemaining } from "./usage";

export interface RouteOptions {
  blockedModelIds?: string[];
  /** Force a specific model first (user selected it in settings). */
  preferredModelId?: string | null;
  now?: number;
}

export interface RankedModel extends GeminiModel {
  score: number;
  cooldownMs: number;
  reason: string;
}

/**
 * Ranks only free-tier documented Gemini models for a task. Models whose free
 * usage is unknown or that are paid-only are never routed automatically.
 */
export function rankModels(
  models: GeminiModel[],
  task: TaskKind,
  options: RouteOptions = {},
): RankedModel[] {
  const now = options.now ?? Date.now();
  const blocked = new Set(options.blockedModelIds ?? []);

  const candidates = models
    .filter((model) => model.textCapable)
    .filter((model) => model.methods.includes("generateContent"))
    .filter((model) => model.freeTier === "free" && model.freeSource !== "none")
    .filter((model) => !model.deprecated)
    .filter((model) => !blocked.has(model.id))
    .map<RankedModel>((model) => {
      const weights = lookupCatalog(model.id).weights;
      const base = weights[task] ?? 1;
      const cooldownMs = cooldownRemaining(model.id);
      const outputBonus = (model.outputTokenLimit ?? 0) >= 8192 ? 0.4 : 0;
      const preferred = options.preferredModelId === model.id;
      const score = base + outputBonus + (preferred ? 5 : 0);
      const reason = preferred
        ? "사용자가 지정한 모델"
        : `무료 티어 문서 확인 · 작업 적합도 ${base}/10`;
      return { ...model, score, cooldownMs, reason };
    })
    .filter((model) => model.score > 0);

  const available = candidates.filter((model) => model.cooldownMs <= now || model.cooldownMs === 0);
  const cooling = candidates.filter((model) => model.cooldownMs > 0);

  const sortByScore = (list: RankedModel[]) =>
    list.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.outputTokenLimit ?? 0) - (a.outputTokenLimit ?? 0);
    });

  return [...sortByScore(available), ...sortByScore(cooling)];
}

export function isRoutable(model: GeminiModel, options: RouteOptions = {}): boolean {
  return rankModels([model], "analysis", options).length > 0;
}
