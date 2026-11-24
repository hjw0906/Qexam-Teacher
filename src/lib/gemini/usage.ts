import type {
  ModelUsageStat,
  ServerLimitObservation,
  UsageRecord,
  UsageErrorKind,
} from "../types";
import { loadJson, saveJson } from "../storage";
import { uid } from "../utils";

const USAGE_KEY = "usage.v1";
const LIMITS_KEY = "limits.v1";
const COOLDOWN_KEY = "cooldowns.v1";
const MAX_RECORDS = 1500;

export interface NewUsageRecord {
  modelId: string;
  task: UsageRecord["task"];
  ok: boolean;
  status?: number;
  errorKind?: UsageErrorKind;
  errorCode?: string;
  errorMessage?: string;
  promptTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  limitHit?: boolean;
  switched?: boolean;
}

export function loadUsage(): UsageRecord[] {
  return loadJson<UsageRecord[]>(USAGE_KEY, []);
}

export function recordUsage(input: NewUsageRecord): UsageRecord {
  const record: UsageRecord = {
    id: uid("use"),
    at: new Date().toISOString(),
    ...input,
  };
  const next = [record, ...loadUsage()].slice(0, MAX_RECORDS);
  saveJson(USAGE_KEY, next);
  return record;
}

export function clearUsage(): void {
  saveJson(USAGE_KEY, []);
  saveJson(LIMITS_KEY, []);
  saveJson(COOLDOWN_KEY, {});
}

export function loadLimitObservations(): ServerLimitObservation[] {
  return loadJson<ServerLimitObservation[]>(LIMITS_KEY, []);
}

export function recordLimitObservation(observation: ServerLimitObservation): void {
  const list = loadLimitObservations().filter((item) => item.modelId !== observation.modelId);
  saveJson(LIMITS_KEY, [observation, ...list].slice(0, 100));
}

export function latestLimitFor(modelId: string): ServerLimitObservation | null {
  return loadLimitObservations().find((item) => item.modelId === modelId) ?? null;
}

export function usageStats(records: UsageRecord[] = loadUsage()): {
  byModel: Record<string, ModelUsageStat>;
  daily: { date: string; success: number; failure: number; limit: number }[];
  totalRequests: number;
  totalSuccess: number;
  totalFailure: number;
} {
  const byModel: Record<string, ModelUsageStat> = {};
  const dailyMap = new Map<string, { success: number; failure: number; limit: number }>();

  for (const record of records) {
    const stat =
      byModel[record.modelId] ??
      (byModel[record.modelId] = {
        modelId: record.modelId,
        requests: 0,
        success: 0,
        failure: 0,
        limitHits: 0,
        promptTokens: 0,
        outputTokens: 0,
        lastUsedAt: null,
        lastError: null,
      });
    stat.requests += 1;
    if (record.ok) stat.success += 1;
    else stat.failure += 1;
    if (record.limitHit) stat.limitHits += 1;
    stat.promptTokens += record.promptTokens ?? 0;
    stat.outputTokens += record.outputTokens ?? 0;
    if (!stat.lastUsedAt || record.at > stat.lastUsedAt) stat.lastUsedAt = record.at;
    if (!record.ok && record.errorMessage) stat.lastError = record.errorMessage;

    const day = record.at.slice(0, 10);
    const bucket = dailyMap.get(day) ?? { success: 0, failure: 0, limit: 0 };
    if (record.ok) bucket.success += 1;
    else bucket.failure += 1;
    if (record.limitHit) bucket.limit += 1;
    dailyMap.set(day, bucket);
  }

  const daily = [...dailyMap.entries()]
    .map(([date, value]) => ({ date, ...value }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14);

  const totalRequests = records.length;
  const totalSuccess = records.filter((record) => record.ok).length;
  return {
    byModel,
    daily,
    totalRequests,
    totalSuccess,
    totalFailure: totalRequests - totalSuccess,
  };
}

/* ---------------- per-model cooldown after quota errors ---------------- */

type Cooldowns = Record<string, number>;

export function loadCooldowns(): Cooldowns {
  return loadJson<Cooldowns>(COOLDOWN_KEY, {});
}

export function setCooldown(modelId: string, milliseconds: number): void {
  const cooldowns = loadCooldowns();
  cooldowns[modelId] = Date.now() + Math.max(1000, milliseconds);
  saveJson(COOLDOWN_KEY, cooldowns);
}

export function cooldownRemaining(modelId: string): number {
  const until = loadCooldowns()[modelId];
  if (!until) return 0;
  return Math.max(0, until - Date.now());
}

export function clearCooldowns(): void {
  saveJson(COOLDOWN_KEY, {});
}

/** Tier evidence comes only from Google's own quota errors. */
export function tierEvidence(): { tier: "free" | "paid" | "unknown"; evidence: string } {
  const observations = loadLimitObservations();
  const free = observations.find((item) =>
    `${item.quotaId ?? ""} ${item.quotaMetric ?? ""} ${item.message}`.toLowerCase().includes("free"),
  );
  if (free) {
    return {
      tier: "free",
      evidence: `Google API 429 응답의 할당량 지표에 무료 티어 표기가 확인되었습니다 (${free.quotaId ?? free.quotaMetric ?? "quota"}).`,
    };
  }
  const paid = observations.find((item) =>
    /paid|billing/i.test(`${item.quotaId ?? ""} ${item.quotaMetric ?? ""} ${item.message}`),
  );
  if (paid) {
    return {
      tier: "paid",
      evidence: "Google API 응답에서 유료 결제 관련 할당량 지표가 확인되었습니다.",
    };
  }
  return {
    tier: "unknown",
    evidence:
      "Google은 API 키의 결제/티어를 조회하는 공식 엔드포인트를 제공하지 않습니다. 요청을 보내지 않고는 확인할 수 없어 '확인 불가'로 표시합니다.",
  };
}
