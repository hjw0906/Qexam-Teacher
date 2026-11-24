import { create } from "zustand";
import type { DiagnosticsResult, GeminiModel, TierVerdict, UsageRecord } from "../lib/types";
import { GeminiApiError, listModels, toGeminiModel } from "../lib/gemini/client";
import { FREE_CATALOG } from "../lib/gemini/catalog";
import {
  clearUsage,
  loadUsage,
  recordLimitObservation,
  tierEvidence,
} from "../lib/gemini/usage";
import { loadJson, saveJson } from "../lib/storage";
import {
  deleteSecret,
  readSecret,
  saveSecret,
  secretStatus,
} from "../lib/tauri";
import { errorMessage, nowIso } from "../lib/utils";

interface AiPrefs {
  billingConfirmed: boolean;
  preferredModelId: string | null;
  blockedModelIds: string[];
  autoCheckedAt: string | null;
}

interface CachedDiagnostics {
  models: GeminiModel[];
  checkedAt: string | null;
  keyValid: boolean;
  message?: string;
}

interface AiState {
  initialized: boolean;
  keyPresent: boolean;
  keyMethod: string;
  keyPath: string;
  keyValid: boolean;
  status: "idle" | "checking" | "ready" | "error";
  models: GeminiModel[];
  lastCheckedAt: string | null;
  tier: TierVerdict;
  tierEvidence: string;
  billingConfirmed: boolean;
  preferredModelId: string | null;
  blockedModelIds: string[];
  usage: UsageRecord[];
  error: string | null;

  init: () => Promise<void>;
  saveKey: (key: string) => Promise<DiagnosticsResult>;
  removeKey: () => Promise<void>;
  testConnection: (key?: string) => Promise<DiagnosticsResult>;
  refreshModels: () => Promise<DiagnosticsResult | null>;
  setBillingConfirmed: (value: boolean) => void;
  setPreferredModel: (modelId: string | null) => void;
  toggleBlockedModel: (modelId: string) => void;
  refreshUsage: () => void;
  noteServerQuotaEvidence: (error: GeminiApiError, modelId: string, task: UsageRecord["task"]) => void;
  resetUsage: () => void;
}

const PREFS_KEY = "ai.prefs.v1";
const CACHE_KEY = "ai.diagnostics.v1";

function loadPrefs(): AiPrefs {
  return {
    billingConfirmed: false,
    preferredModelId: null,
    blockedModelIds: [],
    autoCheckedAt: null,
    ...loadJson<Partial<AiPrefs>>(PREFS_KEY, {}),
  };
}

function savePrefs(state: AiState): void {
  saveJson(PREFS_KEY, {
    billingConfirmed: state.billingConfirmed,
    preferredModelId: state.preferredModelId,
    blockedModelIds: state.blockedModelIds,
    autoCheckedAt: state.lastCheckedAt,
  } satisfies AiPrefs);
}

function loadCache(): CachedDiagnostics {
  return {
    models: [],
    checkedAt: null,
    keyValid: false,
    ...loadJson<Partial<CachedDiagnostics>>(CACHE_KEY, {}),
  };
}

function computeDiagnostics(models: GeminiModel[], keyValid: boolean): DiagnosticsResult {
  const textModels = models.filter((model) => model.textCapable);
  const evidence = tierEvidence();
  return {
    keyValid,
    keyCheckedAt: nowIso(),
    tier: evidence.tier,
    tierEvidence: evidence.evidence,
    models,
    totalModels: textModels.length,
    freeModels: textModels.filter((model) => model.freeTier === "free").length,
    paidOnlyModels: textModels.filter((model) => model.freeTier === "paid-only").length,
    unknownModels: textModels.filter((model) => model.freeTier === "unknown").length,
  };
}

function describeFailure(error: unknown): string {
  if (error instanceof GeminiApiError) {
    switch (error.kind) {
      case "invalid-key":
        return "API 키가 유효하지 않습니다. Google AI Studio에서 발급한 키를 다시 확인해 주세요.";
      case "permission":
        return "이 API 키에는 Generative Language API 접근 권한이 없습니다.";
      case "network":
        return "네트워크에 연결할 수 없습니다.";
      case "timeout":
        return "요청 시간이 초과되었습니다.";
      case "quota":
        return "요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.";
      default:
        return error.message;
    }
  }
  return errorMessage(error);
}

export const useAiStore = create<AiState>((set, get) => ({
  initialized: false,
  keyPresent: false,
  keyMethod: "-",
  keyPath: "-",
  keyValid: false,
  status: "idle",
  models: [],
  lastCheckedAt: null,
  tier: "unknown",
  tierEvidence: "아직 진단하지 않았습니다.",
  billingConfirmed: false,
  preferredModelId: null,
  blockedModelIds: [],
  usage: [],
  error: null,

  init: async () => {
    if (get().initialized) return;
    set({ initialized: true });
    const prefs = loadPrefs();
    const cache = loadCache();
    const evidence = tierEvidence();
    set({
      initialized: true,
      billingConfirmed: prefs.billingConfirmed,
      preferredModelId: prefs.preferredModelId,
      blockedModelIds: prefs.blockedModelIds,
      models: cache.models ?? [],
      lastCheckedAt: cache.checkedAt,
      keyValid: cache.keyValid,
      tier: evidence.tier,
      tierEvidence: evidence.evidence,
      usage: loadUsage(),
    });
    try {
      const status = await secretStatus();
      set({
        keyPresent: status.exists,
        keyMethod: status.method,
        keyPath: status.path,
      });
      if (status.exists) await get().refreshModels();
    } catch (error) {
      set({ error: describeFailure(error) });
    }
  },

  saveKey: async (key: string) => {
    set({ status: "checking", error: null });
    try {
      const models = await listModels(key.trim());
      await saveSecret(key.trim());
      const diagnostics = computeDiagnostics(models, true);
      const status = await secretStatus();
      set({
        keyPresent: true,
        keyValid: true,
        models,
        lastCheckedAt: diagnostics.keyCheckedAt,
        status: "ready",
        tier: diagnostics.tier,
        tierEvidence: diagnostics.tierEvidence,
        keyMethod: status.method,
        keyPath: status.path,
        error: null,
      });
      saveJson(CACHE_KEY, {
        models,
        checkedAt: diagnostics.keyCheckedAt,
        keyValid: true,
      } satisfies CachedDiagnostics);
      savePrefs(get());
      return diagnostics;
    } catch (error) {
      set({ status: "error", keyValid: false, error: describeFailure(error) });
      throw error;
    }
  },

  removeKey: async () => {
    await deleteSecret();
    saveJson(CACHE_KEY, { models: [], checkedAt: null, keyValid: false });
    set({
      keyPresent: false,
      keyValid: false,
      models: [],
      lastCheckedAt: null,
      status: "idle",
      error: null,
      tier: "unknown",
      tierEvidence: "API 키가 삭제되어 진단 정보가 없습니다.",
    });
  },

  testConnection: async (key?: string) => {
    set({ status: "checking", error: null });
    const effectiveKey = (key ?? (await readSecret()) ?? "").trim();
    if (!effectiveKey) {
      set({ status: "error", keyValid: false, error: "저장된 API 키가 없습니다." });
      throw new Error("저장된 API 키가 없습니다.");
    }
    try {
      const models = await listModels(effectiveKey);
      const diagnostics = computeDiagnostics(models, true);
      set({
        keyValid: true,
        models,
        lastCheckedAt: diagnostics.keyCheckedAt,
        status: "ready",
        tier: diagnostics.tier,
        tierEvidence: diagnostics.tierEvidence,
        error: null,
      });
      saveJson(CACHE_KEY, {
        models,
        checkedAt: diagnostics.keyCheckedAt,
        keyValid: true,
      } satisfies CachedDiagnostics);
      return diagnostics;
    } catch (error) {
      set({ status: "error", keyValid: false, error: describeFailure(error) });
      throw error;
    }
  },

  refreshModels: async () => {
    const key = (await readSecret())?.trim();
    if (!key) return null;
    set({ status: "checking" });
    try {
      const models = await listModels(key);
      const diagnostics = computeDiagnostics(models, true);
      const previous = get().models;
      const previousIds = new Set(previous.map((model) => model.id));
      const added = models.filter((model) => !previousIds.has(model.id));
      const removed = previous.filter(
        (model) => !models.some((candidate) => candidate.id === model.id),
      );
      set({
        models,
        keyValid: true,
        lastCheckedAt: diagnostics.keyCheckedAt,
        status: "ready",
        tier: diagnostics.tier,
        tierEvidence: diagnostics.tierEvidence,
        error:
          previous.length && (added.length || removed.length)
            ? `모델 목록이 갱신되었습니다. 추가 ${added.length}개 · 제외 ${removed.length}개`
            : null,
      });
      saveJson(CACHE_KEY, {
        models,
        checkedAt: diagnostics.keyCheckedAt,
        keyValid: true,
      } satisfies CachedDiagnostics);
      savePrefs(get());
      return diagnostics;
    } catch (error) {
      set({ status: "error", error: describeFailure(error) });
      return null;
    }
  },

  setBillingConfirmed: (value: boolean) => {
    set({ billingConfirmed: value });
    savePrefs(get());
  },

  setPreferredModel: (modelId: string | null) => {
    set({ preferredModelId: modelId });
    savePrefs(get());
  },

  toggleBlockedModel: (modelId: string) => {
    const blocked = get().blockedModelIds;
    const next = blocked.includes(modelId)
      ? blocked.filter((id) => id !== modelId)
      : [...blocked, modelId];
    set({ blockedModelIds: next });
    savePrefs(get());
  },

  refreshUsage: () => set({ usage: loadUsage() }),

  noteServerQuotaEvidence: (error, modelId, task) => {
    if (!error.freeTierEvidence && !error.paidEvidence) return;
    recordLimitObservation({
      modelId,
      quotaId: error.quotaId,
      quotaMetric: error.quotaMetric,
      quotaValue: error.quotaValue,
      retryAfterMs: error.retryAfterMs,
      status: error.status,
      message: `${error.message} (${task})`,
      observedAt: nowIso(),
    });
    const evidence = tierEvidence();
    set({ tier: evidence.tier, tierEvidence: evidence.evidence });
  },

  resetUsage: () => {
    clearUsage();
    set({ usage: [] });
  },
}));

export const catalogMeta = FREE_CATALOG;

export function refreshModelFromRaw(raw: unknown): GeminiModel | null {
  if (!raw || typeof raw !== "object") return null;
  return toGeminiModel(raw as Record<string, unknown>);
}
