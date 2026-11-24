import { useRef, useState } from "react";
import { FileText, FileUp, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import {
  Button,
  Card,
  Field,
  Input,
  ProgressBar,
  SectionHeader,
  Select,
  Textarea,
} from "../components/ui";
import { ACCEPTED_PASSAGE_FILES, extractTextFromFile, terminateOcr } from "../lib/ocr";
import {
  isTauri,
  pickBrowserFile,
  pickOpenFile,
  readBinaryFile,
} from "../lib/tauri";
import { useProjectStore } from "../store/projectStore";
import { useAiStore } from "../store/aiStore";
import { toast } from "../store/uiStore";
import { detectLanguage, errorMessage } from "../lib/utils";
import type { Passage, PassageSource } from "../lib/types";

function mimeFor(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "text/plain";
}

export function NewProjectPage() {
  const newProject = useProjectStore((state) => state.newProject);
  const setView = useProjectStore((state) => state.setView);
  const keyPresent = useAiStore((state) => state.keyPresent);
  const billingConfirmed = useAiStore((state) => state.billingConfirmed);

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [language, setLanguage] = useState<Passage["language"]>("auto");
  const [sources, setSources] = useState<PassageSource[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ percent: number; message: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const detectLang = language === "auto" ? detectLanguage(text) : language;
  const charCount = text.trim().length;

  async function handleFile(file: File | null) {
    if (!file) return;
    setProgress({ percent: 2, message: "파일 읽는 중" });
    try {
      const result = await extractTextFromFile(file, (percent, message) =>
        setProgress({ percent, message }),
      );
      setText((previous) => (previous.trim() ? `${previous.trim()}\n\n${result.text}` : result.text));
      const kind: PassageSource["kind"] =
        result.kind === "image" ? "image" : result.kind === "pdf" ? "pdf" : "txt";
      setSources((previous) => [
        ...previous,
        { name: result.fileName, kind, addedAt: new Date().toISOString() },
      ]);
      if (result.notes.length) setNotes((previous) => [...previous, ...result.notes]);
      if (!title.trim()) setTitle(result.fileName.replace(/\.[^.]+$/, ""));
      if (!name.trim()) setName(result.fileName.replace(/\.[^.]+$/, ""));
      toast.success("텍스트를 추출했습니다.", `${result.fileName} · ${result.text.length.toLocaleString()}자`);
    } catch (error) {
      toast.error("파일을 처리하지 못했습니다.", errorMessage(error));
    } finally {
      setProgress(null);
    }
  }

  async function pickAndHandle() {
    if (isTauri) {
      const path = await pickOpenFile([
        { name: "지문 파일", extensions: ["txt", "pdf", "png", "jpg", "jpeg", "webp"] },
      ]);
      if (!path) return;
      try {
        const bytes = await readBinaryFile(path);
        const fileName = path.split(/[\\/]/).pop() ?? "첨부파일";
        await handleFile(new File([bytes as unknown as BlobPart], fileName, { type: mimeFor(fileName) }));
      } catch (error) {
        toast.error("파일을 읽지 못했습니다.", errorMessage(error));
      }
      return;
    }
    const file = await pickBrowserFile(ACCEPTED_PASSAGE_FILES);
    await handleFile(file);
  }

  function submit() {
    if (!text.trim()) {
      toast.warning("지문을 입력해 주세요.");
      return;
    }
    const passage: Passage = {
      title: title.trim() || name.trim() || "지문",
      text: text.trim(),
      language,
      sources,
      ocrNotes: notes,
    };
    newProject(name.trim() || title.trim() || "새 프로젝트", passage);
  }

  return (
    <div className="scroll-area h-full">
      <div className="mx-auto max-w-5xl px-8 py-8">
        <SectionHeader
          title="새 프로젝트"
          description="지문을 붙여넣거나 PDF·텍스트·이미지 파일을 첨부하세요. 이미지와 스캔 PDF는 로컬 OCR로 글자를 추출합니다."
          actions={
            <Button variant="ghost" size="sm" onClick={() => setView("home")}>
              홈으로
            </Button>
          }
        />

        {!keyPresent || !billingConfirmed ? (
          <Card className="mt-4 flex items-start gap-3 border-amber-200 bg-amber-50 p-4">
            <TriangleAlert className="mt-0.5 h-4 w-4 flex-none text-amber-600" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900">AI 기능을 쓰려면 설정이 필요합니다</p>
              <p className="mt-0.5 text-xs leading-relaxed text-amber-700">
                지문 입력과 편집은 지금도 가능합니다. AI 생성은 Gemini API 키 저장과 무료(비과금)
                사용 확인 후에 활성화됩니다.
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setView("ai")}>
              AI 설정
            </Button>
          </Card>
        ) : null}

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_280px]">
          <Card className="p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="프로젝트 이름">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="예: 2026 고2 여름특강 Week 1"
                />
              </Field>
              <Field label="지문 제목">
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="예: The Paradox of Choice"
                />
              </Field>
            </div>

            <div
              className={`mt-4 rounded-xl border-2 border-dashed p-4 transition ${
                dragging ? "border-brand-400 bg-brand-50/60" : "border-slate-200 bg-slate-50/60"
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const file = event.dataTransfer.files?.[0];
                void handleFile(file ?? null);
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <FileUp className="h-4 w-4 text-brand-600" />
                  <span className="font-medium">파일 첨부</span>
                  <span className="text-slate-400">TXT · PDF · PNG · JPG · JPEG · WEBP</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void pickAndHandle()}>
                    파일 선택
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_PASSAGE_FILES}
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      void handleFile(file ?? null);
                      event.target.value = "";
                    }}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => fileInputRef.current?.click()}
                    title="브라우저 파일 선택"
                  >
                    드래그 대신 찾기
                  </Button>
                </div>
              </div>
              {progress ? (
                <div className="mt-3">
                  <div className="flex items-center gap-2 text-[11px] text-brand-700">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {progress.message} ({progress.percent}%)
                  </div>
                  <ProgressBar value={progress.percent} className="mt-1.5" />
                </div>
              ) : null}
              {sources.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {sources.map((source, index) => (
                    <span
                      key={`${source.name}-${index}`}
                      className="chip bg-white text-slate-600 ring-1 ring-slate-200"
                    >
                      <FileText className="h-3 w-3" />
                      {source.name}
                      <span className="text-slate-400">· {source.kind.toUpperCase()}</span>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <Field
              label="지문 내용"
              className="mt-4"
              hint={
                <>
                  {charCount.toLocaleString()}자 · 감지 언어: {detectLang === "ko" ? "한국어" : "영어"} ·
                  OCR 결과가 애매한 부분은 반드시 직접 수정하세요.
                </>
              }
            >
              <Textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={16}
                placeholder="영어 또는 한글 지문을 붙여넣으세요.&#10;&#10;예)&#10;Choice overload is the psychological stress consumers feel when...&#10;..."
              />
            </Field>

            {notes.length ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-900">인식 참고 사항</p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-amber-700">
                  {notes.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">지문 언어</span>
                <Select
                  value={language}
                  onChange={(event) => setLanguage(event.target.value as Passage["language"])}
                  className="w-36"
                >
                  <option value="auto">자동 감지</option>
                  <option value="en">영어</option>
                  <option value="ko">한국어</option>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => void terminateOcr()}>
                  OCR 엔진 종료
                </Button>
                <Button
                  variant="primary"
                  icon={<Sparkles className="h-4 w-4" />}
                  onClick={submit}
                  disabled={!text.trim()}
                >
                  프로젝트 만들기
                </Button>
              </div>
            </div>
          </Card>

          <div className="space-y-4">
            <Card className="p-4">
              <p className="text-sm font-bold text-slate-800">이렇게 진행됩니다</p>
              <ol className="mt-3 space-y-2.5 text-xs leading-relaxed text-slate-600">
                <li>1. 지문을 입력하거나 첨부합니다.</li>
                <li>2. 프로젝트를 만들면 작업 화면으로 이동합니다.</li>
                <li>3. ‘지문 분석’을 실행하면 주제·구조·문단별 정리가 생성됩니다.</li>
                <li>4. 쉬운 설명 → 단어 → 워크북 → 답안지 → 검증 순서로 이어서 만듭니다.</li>
                <li>5. 문서 편집기에서 다듬고 PDF/PNG로 출력합니다.</li>
              </ol>
            </Card>
            <Card className="p-4">
              <p className="text-sm font-bold text-slate-800">파일 처리 안내</p>
              <ul className="mt-2 space-y-2 text-[11px] leading-relaxed text-slate-500">
                <li>· PDF는 먼저 텍스트를 추출하고, 텍스트가 없으면 최대 8페이지까지 OCR합니다.</li>
                <li>· 이미지 OCR은 한국어+영어를 함께 인식합니다. 처음 인식 시 수 초가 걸릴 수 있습니다.</li>
                <li>· OCR·PDF 처리는 모두 이 PC에서 실행되며 파일이 외부로 전송되지 않습니다.</li>
                <li>· 긴 지문은 AI 분석 시 앞부분 약 14,000자까지 사용합니다.</li>
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
