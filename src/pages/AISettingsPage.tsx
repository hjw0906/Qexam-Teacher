import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Input,
  KeyValue,
  SectionHeader,
  Toggle,
} from "../components/ui";
import { DailyUsageChart, ShareBar } from "../components/Charts";
import { ModelQuickSelect, ModelTable } from "../components/ModelTable";
import { useAiStore, catalogMeta } from "../store/aiStore";
import { toast } from "../store/uiStore";
import { cooldownRemaining, loadLimitObservations, usageStats } from "../lib/gemini/usage";
import { errorMessage, formatDateTime, relativeTime } from "../lib/utils";

export function AISettingsPage() {
  const {
    keyPresent,
    keyValid,
    keyMethod,
    keyPath,
    models,
    lastCheckedAt,
    tier,
    tierEvidence,
    billingConfirmed,
    preferredModelId,
    usage,
    status,
    error,
    saveKey,
    removeKey,
    testConnection,
    refreshModels,
    setBillingConfirmed,
    setPreferredModel,
    refreshUsage,
    resetUsage,
  } = useAiStore();

  const [keyInput, setKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const stats = useMemo(() => usageStats(usage), [usage]);
  const limits = useMemo(() => loadLimitObservations(), [usage]);
  const freeModels = models.filter((model) => model.textCapable && model.freeTier === "free");
  const textModels = models.filter((model) => model.textCapable);

  async function handleSaveKey() {
    const trimmed = keyInput.trim();
    if (!trimmed) {
      toast.warning("API 키를 입력해 주세요.");
      return;
    }
    setBusy("save");
    try {
      const diagnostics = await saveKey(trimmed);
      setKeyInput("");
      toast.success(
        "API 키를 저장했습니다.",
        `모델 ${diagnostics.totalModels}개 확인 · 키는 Windows DPAPI로 암호화됩니다.`,
      );
    } catch (failure) {
      toast.error("API 키를 저장하지 못했습니다.", errorMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  async function handleTest() {
    setBusy("test");
    try {
      const diagnostics = await testConnection();
      toast.success(
        "연결 테스트 성공",
        `사용 가능 모델 ${diagnostics.totalModels}개 · 무료 ${diagnostics.freeModels}개`,
      );
    } catch (failure) {
      toast.error("연결 테스트 실패", errorMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  async function handleRefresh() {
    setBusy("refresh");
    try {
      const diagnostics = await refreshModels();
      if (diagnostics) {
        toast.success("모델 목록을 새로고침했습니다.", `총 ${diagnostics.totalModels}개 텍스트 모델`);
      } else {
        toast.error("모델 목록을 가져오지 못했습니다.", "API 키와 네트워크를 확인하세요.");
      }
    } finally {
      setBusy(null);
    }
  }

  const tierLabel =
    tier === "free" ? "Free Tier (서버 증거 확인)" : tier === "paid" ? "Paid Tier (서버 증거)" : "확인 불가";

  return (
    <div className="scroll-area h-full">
      <div className="mx-auto max-w-6xl px-8 py-8">
        <SectionHeader
          title="AI 설정"
          description="Google Gemini API 키를 저장하고, 모델 목록·무료 사용 여부·자체 사용량을 확인합니다. 로그인이나 외부 서버는 사용하지 않습니다."
          actions={
            <>
              <Button
                size="sm"
                variant="secondary"
                icon={<RefreshCw className="h-3.5 w-3.5" />}
                loading={busy === "refresh"}
                onClick={() => void handleRefresh()}
              >
                모델 목록 새로고침
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={<Activity className="h-3.5 w-3.5" />}
                loading={busy === "test"}
                onClick={() => void handleTest()}
                disabled={!keyPresent}
              >
                연결 테스트
              </Button>
            </>
          }
        />

        {error ? (
          <Card className="mt-4 flex items-start gap-2 border-red-200 bg-red-50 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-red-600" />
            <p className="whitespace-pre-line text-xs leading-relaxed text-red-700">{error}</p>
          </Card>
        ) : null}

        <div className="mt-5 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
          <Card className="p-5">
            <SectionHeader
              title="Gemini API 키"
              description="키는 EXE에 포함되지 않으며, Windows DPAPI로 암호화되어 현재 Windows 사용자만 복호화할 수 있습니다."
              actions={
                <Badge tone={keyPresent ? (keyValid ? "green" : "amber") : "slate"}>
                  <KeyRound className="h-3 w-3" />
                  {keyPresent ? (keyValid ? "저장됨 · 유효" : "저장됨 · 확인 필요") : "미등록"}
                </Badge>
              }
            />
            <div className="mt-4">
              <Field
                label={keyPresent ? "새 API 키로 교체" : "API 키 입력"}
                hint="Google AI Studio(https://aistudio.google.com/apikey)에서 발급한 키를 붙여넣으세요. 키는 화면·로그·오류 메시지에 표시되지 않습니다."
              >
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showKey ? "text" : "password"}
                      value={keyInput}
                      onChange={(event) => setKeyInput(event.target.value)}
                      placeholder={keyPresent ? "•••••••• (저장된 키를 교체하려면 입력)" : "AIza..."}
                      autoComplete="off"
                      spellCheck={false}
                      className="pr-10 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((value) => !value)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"
                      aria-label={showKey ? "키 숨기기" : "키 표시"}
                      title={showKey ? "키 숨기기" : "키 표시"}
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <Button
                    variant="primary"
                    loading={busy === "save"}
                    onClick={() => void handleSaveKey()}
                    disabled={!keyInput.trim()}
                  >
                    {keyPresent ? "키 교체" : "키 저장"}
                  </Button>
                </div>
              </Field>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={status === "checking" && busy === null}
                  onClick={() => void handleTest()}
                  disabled={!keyPresent}
                >
                  연결 확인
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => setConfirmDelete(true)}
                  disabled={!keyPresent}
                >
                  키 삭제
                </Button>
              </div>
              <div className="mt-4 rounded-lg bg-slate-50 p-3">
                <KeyValue label="저장 방식" value={keyMethod} />
                <KeyValue
                  label="저장 위치"
                  value={<span className="break-all font-mono text-[10px]">{keyPath}</span>}
                />
                <KeyValue label="마지막 진단" value={formatDateTime(lastCheckedAt)} />
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <SectionHeader
              title="API 환경 진단"
              description="models.list 결과와 Google의 오류 응답만 근거로 표시합니다. 추정하지 않습니다."
            />
            <div className="mt-3">
              <KeyValue label="API 키 유효성" value={keyPresent ? (keyValid ? "유효" : "확인 필요") : "미등록"} />
              <KeyValue
                label="티어 판별"
                value={<span className="font-semibold">{tierLabel}</span>}
              />
              <KeyValue label="접근 가능 모델" value={`${textModels.length}개 (텍스트)`} />
              <KeyValue label="무료 사용 가능" value={`${stats ? freeModels.length : 0}개`} />
              <KeyValue
                label="유료 전용"
                value={`${textModels.filter((model) => model.freeTier === "paid-only").length}개`}
              />
              <KeyValue
                label="무료 확인 불가"
                value={`${textModels.filter((model) => model.freeTier === "unknown").length}개`}
              />
              <KeyValue label="마지막 점검" value={lastCheckedAt ? relativeTime(lastCheckedAt) : "-"} />
            </div>
            <p className="mt-3 rounded-lg bg-slate-50 p-2.5 text-[11px] leading-relaxed text-slate-500">
              {tierEvidence}
            </p>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
              Google은 API 키의 결제 연결 여부를 조회하는 공식 엔드포인트를 제공하지 않습니다. 따라서
              확인할 수 없는 값은 ‘확인 불가’로 표시하며, 확인되지 않은 모델은 자동 호출하지 않습니다.
            </p>
          </Card>
        </div>

        <Card className="mt-5 border-amber-200 p-5">
          <SectionHeader
            title="무료(비과금) 사용 확인"
            description="유료 결제가 발생할 수 있는 요청을 보내지 않기 위한 필수 확인입니다."
          />
          <div className="mt-4 flex flex-wrap items-start gap-4">
            <div className="flex-1 min-w-[280px]">
              <Toggle
                checked={billingConfirmed}
                onChange={(value) => {
                  setBillingConfirmed(value);
                  toast.info(
                    value ? "무료 사용 확인이 저장되었습니다." : "AI 호출이 비활성화되었습니다.",
                    value
                      ? "이제 무료 사용이 확인된 Gemini 모델만 자동 호출합니다."
                      : "무료 사용 확인을 해제했습니다.",
                  );
                }}
                label="이 API 키의 프로젝트에는 결제(빌링) 계정이 연결되어 있지 않습니다"
                description="확인하면 위 조건에서 무료 티어로 제공되는 모델만 호출합니다. 결제가 연결된 프로젝트에서는 같은 요청도 과금될 수 있어 자동으로 판단하지 않습니다."
              />
              <ul className="mt-3 space-y-1 text-[11px] leading-relaxed text-slate-500">
                <li>· 유료 전용 모델(gemini-4-carbon/neon/argon, gemini-3.1-pro 등)은 자동 라우팅에서 제외됩니다.</li>
                <li>· 무료 여부가 확인되지 않은 모델도 자동 호출하지 않습니다.</li>
                <li>· 무료 한도 초과 시 유료 모델로 전환하지 않고, 작업을 저장한 뒤 대기합니다.</li>
                <li>· 무료 티어의 입력/출력은 Google 제품 개선에 사용될 수 있으므로 민감한 자료는 사용하지 마세요.</li>
              </ul>
            </div>
            <div className="w-full max-w-[260px] rounded-lg bg-slate-50 p-3">
              <p className="text-[11px] font-semibold text-slate-700">우선 사용 모델</p>
              <div className="mt-1.5">
                <ModelQuickSelect value={preferredModelId} onChange={setPreferredModel} models={models} />
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                지정하지 않으면 작업 종류별 적합도와 남은 쿨다운을 기준으로 자동 선택합니다.
              </p>
              <div className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-500">
                <ShieldCheck className="h-3 w-3 text-emerald-600" />
                {billingConfirmed ? "무료 사용 확인됨" : "확인 전 · AI 호출 차단"}
              </div>
            </div>
          </div>
        </Card>

        <Card className="mt-5 p-5">
          <SectionHeader
            title="Gemini 모델"
            description={`models.list에서 실제로 조회된 모델입니다. 무료 여부는 ${catalogMeta.sourceLabel} (${catalogMeta.checkedAt}) 기준입니다.`}
            actions={
              <Button size="sm" variant="ghost" onClick={() => void handleRefresh()} loading={busy === "refresh"}>
                새로고침
              </Button>
            }
          />
          <div className="mt-4">
            <ModelTable models={models} />
          </div>
        </Card>

        <Card className="mt-5 p-5">
          <SectionHeader
            title="사용량 대시보드"
            description="프로그램이 로컬에 기록한 요청 기록입니다. 외부로 전송되지 않으며, Google 서버의 실제 잔여량과는 다릅니다."
            actions={
              <>
                <Button size="sm" variant="ghost" onClick={refreshUsage}>
                  새로고침
                </Button>
                <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setConfirmReset(true)}>
                  기록 지우기
                </Button>
              </>
            }
          />

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "총 요청", value: stats.totalRequests, tone: "text-slate-900" },
              { label: "성공", value: stats.totalSuccess, tone: "text-emerald-600" },
              { label: "실패", value: stats.totalFailure, tone: "text-red-600" },
              {
                label: "한도 발생",
                value: usage.filter((record) => record.limitHit).length,
                tone: "text-amber-600",
              },
            ].map((metric) => (
              <div key={metric.label} className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5">
                <p className="text-[11px] text-slate-500">{metric.label}</p>
                <p className={`mt-0.5 text-xl font-bold tabular-nums ${metric.tone}`}>{metric.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <p className="mb-2 text-xs font-semibold text-slate-700">일별 요청 (자체 기록)</p>
              <DailyUsageChart data={stats.daily} />
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold text-slate-700">모델별 사용 비중</p>
              <div className="space-y-1.5">
                {Object.values(stats.byModel).length ? (
                  Object.values(stats.byModel)
                    .sort((a, b) => b.requests - a.requests)
                    .slice(0, 8)
                    .map((stat) => (
                      <ShareBar
                        key={stat.modelId}
                        label={stat.modelId}
                        value={stat.requests}
                        total={stats.totalRequests}
                        suffix="회"
                      />
                    ))
                ) : (
                  <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">
                    기록이 없습니다.
                  </p>
                )}
              </div>
              <div className="mt-3 rounded-lg bg-slate-50 p-2.5 text-[10px] leading-relaxed text-slate-500">
                <p className="font-semibold text-slate-600">조회 가능 범위</p>
                <p>1. Google 서버 직접 확인: 모델 목록·토큰 한도만 제공됩니다.</p>
                <p>2. Google 응답 기반 제한: 429 오류의 quotaId·재시도 시간 ({limits.length}건 기록).</p>
                <p>3. 프로그램 자체 기록: 요청·성공·실패·토큰 사용량 (위 표).</p>
                <p>4. 조회 불가: 모델별 남은 RPM/RPD/TPM.</p>
              </div>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">모델</th>
                  <th className="px-3 py-2 font-semibold">요청</th>
                  <th className="px-3 py-2 font-semibold">성공/실패</th>
                  <th className="px-3 py-2 font-semibold">토큰</th>
                  <th className="px-3 py-2 font-semibold">한도</th>
                  <th className="px-3 py-2 font-semibold">마지막 사용</th>
                  <th className="px-3 py-2 font-semibold">쿨다운</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Object.values(stats.byModel).map((stat) => {
                  const remaining = cooldownRemaining(stat.modelId);
                  return (
                    <tr key={stat.modelId}>
                      <td className="px-3 py-2 font-mono text-[10.5px] text-slate-700">{stat.modelId}</td>
                      <td className="px-3 py-2 tabular-nums">{stat.requests}</td>
                      <td className="px-3 py-2 tabular-nums">
                        <span className="text-emerald-600">{stat.success}</span> /{" "}
                        <span className="text-red-500">{stat.failure}</span>
                      </td>
                      <td className="px-3 py-2 tabular-nums text-slate-600">
                        {stat.promptTokens.toLocaleString()} / {stat.outputTokens.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{stat.limitHits}</td>
                      <td className="px-3 py-2 text-slate-500">{formatDateTime(stat.lastUsedAt)}</td>
                      <td className="px-3 py-2 text-slate-500">
                        {remaining > 0 ? `${Math.ceil(remaining / 1000)}초` : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!Object.keys(stats.byModel).length ? (
              <p className="px-3 py-5 text-center text-xs text-slate-400">아직 기록된 요청이 없습니다.</p>
            ) : null}
          </div>

          <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50/60 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-800">
              <Sparkles className="h-3.5 w-3.5" /> 무료 사용량 관리
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-brand-700/80">
              모델별 429(할당량 초과)가 발생하면 해당 모델을 일정 시간 쿨다운에 넣고, 무료 사용이
              확인된 다른 Gemini 모델로 자동 전환합니다. 이미 생성된 결과(분석 등)는 재사용하므로 같은
              작업을 처음부터 다시 호출하지 않습니다.
            </p>
          </div>
        </Card>

        <p className="mt-5 text-[10px] leading-relaxed text-slate-400">
          무료 모델 카탈로그 출처: {catalogMeta.sourceUrl} · 기준일 {catalogMeta.checkedAt}. Google이
          가격/무료 정책을 변경하면 모델 목록을 새로고침하고 이 기준일을 함께 확인하세요.
        </p>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="API 키 삭제"
        message="저장된 Gemini API 키를 삭제할까요? 삭제 후에는 AI 기능을 사용할 수 없으며, 다시 입력해야 합니다."
        confirmLabel="삭제"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          void removeKey()
            .then(() => toast.success("API 키를 삭제했습니다."))
            .catch((failure) => toast.error("삭제 실패", errorMessage(failure)));
          setConfirmDelete(false);
        }}
      />

      <ConfirmDialog
        open={confirmReset}
        title="사용 기록 초기화"
        message="로컬에 저장된 API 사용 기록과 서버 한도 관측치, 쿨다운을 모두 삭제할까요? 이 작업은 되돌릴 수 없습니다."
        confirmLabel="초기화"
        danger
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          resetUsage();
          setConfirmReset(false);
          toast.success("사용 기록을 초기화했습니다.");
        }}
      />
    </div>
  );
}
