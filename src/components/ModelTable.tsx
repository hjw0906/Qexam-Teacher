import { useMemo, useState } from "react";
import { Ban, CheckCircle2, CircleSlash, HelpCircle, Star } from "lucide-react";
import { Badge, Button, SegmentedControl, Select } from "./ui";
import type { GeminiModel } from "../lib/types";
import { useAiStore } from "../store/aiStore";
import { latestLimitFor, usageStats } from "../lib/gemini/usage";
import { formatDateTime } from "../lib/utils";

type Filter = "all" | "free" | "paid" | "unknown" | "text";

export function FreeBadge({ model }: { model: GeminiModel }) {
  if (model.freeTier === "free") {
    return (
      <Badge tone="green">
        <CheckCircle2 className="h-3 w-3" /> 무료 사용 가능
      </Badge>
    );
  }
  if (model.freeTier === "paid-only") {
    return (
      <Badge tone="red">
        <Ban className="h-3 w-3" /> 유료 전용 · 차단
      </Badge>
    );
  }
  return (
    <Badge tone="amber">
      <HelpCircle className="h-3 w-3" /> 무료 확인 불가
    </Badge>
  );
}

export function ModelTable({ models }: { models: GeminiModel[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const blocked = useAiStore((state) => state.blockedModelIds);
  const preferred = useAiStore((state) => state.preferredModelId);
  const toggleBlocked = useAiStore((state) => state.toggleBlockedModel);
  const setPreferred = useAiStore((state) => state.setPreferredModel);
  const usage = useAiStore((state) => state.usage);

  const stats = useMemo(() => usageStats(usage), [usage]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return models
      .filter((model) => {
        if (filter === "free") return model.freeTier === "free";
        if (filter === "paid") return model.freeTier === "paid-only";
        if (filter === "unknown") return model.freeTier === "unknown";
        if (filter === "text") return model.textCapable;
        return true;
      })
      .filter(
        (model) =>
          !keyword ||
          model.id.toLowerCase().includes(keyword) ||
          model.displayName.toLowerCase().includes(keyword),
      )
      .sort((a, b) => {
        const rank = (model: GeminiModel) =>
          model.freeTier === "free" ? 0 : model.freeTier === "unknown" ? 1 : 2;
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return b.id.localeCompare(a.id);
      });
  }, [models, filter, query]);

  if (!models.length) {
    return (
      <div className="rounded-lg bg-slate-50 px-4 py-6 text-center text-xs text-slate-500">
        모델 목록이 없습니다. AI 설정에서 키를 저장하거나 ‘모델 목록 새로고침’을 실행하세요.
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: `전체 ${models.length}` },
            { value: "free", label: `무료 ${models.filter((m) => m.freeTier === "free").length}` },
            { value: "paid", label: `유료 전용 ${models.filter((m) => m.freeTier === "paid-only").length}` },
            { value: "unknown", label: `확인 불가 ${models.filter((m) => m.freeTier === "unknown").length}` },
            { value: "text", label: "텍스트" },
          ]}
        />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="모델 검색"
          className="input ml-auto h-8 w-44 py-1 text-xs"
        />
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[900px] border-collapse text-left">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">모델</th>
              <th className="px-3 py-2 font-semibold">무료 여부</th>
              <th className="px-3 py-2 font-semibold">입력/출력 한도</th>
              <th className="px-3 py-2 font-semibold">자체 기록</th>
              <th className="px-3 py-2 font-semibold">서버 확인 한도</th>
              <th className="px-3 py-2 font-semibold">라우팅</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {filtered.map((model) => {
              const stat = stats.byModel[model.id];
              const limit = latestLimitFor(model.id);
              const isBlocked = blocked.includes(model.id);
              const isPreferred = preferred === model.id;
              return (
                <tr key={model.id} className="align-top hover:bg-slate-50/60">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-800">{model.displayName}</span>
                      {isPreferred ? (
                        <Badge tone="violet">
                          <Star className="h-3 w-3" /> 우선
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 font-mono text-[10.5px] text-slate-500">{model.id}</p>
                    {model.description ? (
                      <p className="mt-1 line-clamp-2 max-w-[320px] text-[11px] leading-relaxed text-slate-500">
                        {model.description}
                      </p>
                    ) : null}
                    {model.deprecated ? (
                      <p className="mt-1 text-[10px] font-semibold text-red-600">폐기 예정 · 라우팅 제외</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5">
                    <FreeBadge model={model} />
                    <p className="mt-1 text-[10px] text-slate-400">
                      {model.freeTier === "unknown"
                        ? "Google 가격표에서 확인되지 않음"
                        : "가격표 스냅샷 기준"}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] tabular-nums text-slate-600">
                    <div>입력 {(model.inputTokenLimit ?? 0).toLocaleString()}</div>
                    <div>출력 {(model.outputTokenLimit ?? 0).toLocaleString()}</div>
                    <div className="mt-1 text-[10px] text-slate-400">
                      {model.methods.length}개 메서드 ·{" "}
                      {model.textCapable ? "텍스트 생성" : "텍스트 외"}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[11px] tabular-nums text-slate-600">
                    {stat ? (
                      <>
                        <div>
                          요청 {stat.requests} · 성공 {stat.success}
                        </div>
                        <div>
                          실패 {stat.failure} · 한도 {stat.limitHits}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          마지막 {formatDateTime(stat.lastUsedAt)}
                        </div>
                        {stat.lastError ? (
                          <div className="mt-1 line-clamp-2 max-w-[220px] text-[10px] text-red-500">
                            {stat.lastError}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-slate-400">기록 없음</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-slate-600">
                    {limit ? (
                      <>
                        <div className="font-medium text-slate-700">
                          {limit.quotaId ?? limit.quotaMetric ?? "할당량 오류"}
                        </div>
                        <div className="text-[10px] text-slate-500">HTTP {limit.status}</div>
                        {limit.retryAfterMs ? (
                          <div className="text-[10px] text-slate-500">
                            재시도 대기 {Math.ceil(limit.retryAfterMs / 1000)}초
                          </div>
                        ) : null}
                        <div className="text-[10px] text-slate-400">
                          {formatDateTime(limit.observedAt)}
                        </div>
                      </>
                    ) : (
                      <span className="text-slate-400">Google 응답에 한도 정보 없음</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col gap-1">
                      <Button
                        size="sm"
                        variant={isBlocked ? "secondary" : "ghost"}
                        onClick={() => toggleBlocked(model.id)}
                        className="justify-start"
                      >
                        {isBlocked ? "차단 해제" : "라우팅 차단"}
                      </Button>
                      <Button
                        size="sm"
                        variant={isPreferred ? "subtle" : "ghost"}
                        onClick={() => setPreferred(isPreferred ? null : model.id)}
                        className="justify-start"
                      >
                        {isPreferred ? "우선 해제" : "우선 모델 지정"}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 ? (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-4 text-xs text-slate-500">
          <CircleSlash className="h-3.5 w-3.5" /> 조건에 맞는 모델이 없습니다.
        </div>
      ) : null}
      <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
        ‘서버 확인 한도’는 Google이 429 응답으로 알려준 할당량 정보만 표시합니다. Google은 모델별
        RPM/RPD/TPM 잔여량을 조회하는 공식 API를 제공하지 않으므로 잔여량은 표시하지 않습니다.
      </p>
    </div>
  );
}

export function ModelQuickSelect({
  value,
  onChange,
  models,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  models: GeminiModel[];
}) {
  return (
    <Select
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value || null)}
      className="h-8 py-1 text-xs"
    >
      <option value="">자동 선택 (권장)</option>
      {models
        .filter((model) => model.freeTier === "free" && model.textCapable)
        .map((model) => (
          <option key={model.id} value={model.id}>
            {model.displayName} ({model.id})
          </option>
        ))}
    </Select>
  );
}
