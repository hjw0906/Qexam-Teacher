# Qexam Teacher

**AI-Powered Educational Worksheet Studio** — 학원 선생님을 위한 Windows 데스크톱 학습지 제작 프로그램.

영어/한글 지문을 입력하거나 PDF·이미지로 첨부하면 Google Gemini가 지문을 분석하고,
쉬운 설명 · 단어 시험 · 워크북 · 교사용 답안지를 만들며, PowerPoint처럼 자유롭게 편집해
PDF/PNG로 내보내거나 인쇄할 수 있습니다.

## 기술 스택

| 영역 | 선택 |
| --- | --- |
| 데스크톱 | Tauri 2 (Rust) + WebView2 |
| 프론트엔드 | React 19 + TypeScript + Vite |
| 스타일 | Tailwind CSS |
| AI | Google Gemini API (`generativelanguage.googleapis.com`) |
| OCR | Tesseract.js (kor+eng, 오프라인 자산) + PDF.js |
| PDF/PNG | html2canvas + jsPDF (화면과 동일한 렌더링 캡처) |
| 저장 | `.qws` JSON 프로젝트 파일 (로컬), API 키는 Windows DPAPI 암호화 |
| 빌드 | GitHub Actions → NSIS 설치형 EXE (+ MSI) |

Electron을 사용하지 않아 설치 파일과 메모리 사용량이 작습니다.

## 개발 실행

```bash
npm install
npm run assets     # 아이콘 + 오프라인 OCR 자산 생성 (최초 1회)
npm run dev        # 브라우저 미리보기 (파일 저장은 다운로드로 동작)
npm run typecheck
npm test
npm run build
npm run tauri dev  # 데스크톱 앱으로 실행 (Rust 필요)
```

- 요구 사항: Node.js 20+, Rust stable, Windows 10/11 (데스크톱 빌드)
- Windows 빌드: `npm run tauri build` → `src-tauri/target/release/bundle/{nsis,msi}`

## Windows 설치 파일

GitHub Actions 워크플로우(`.github/workflows/build-windows.yml`)가 `windows-latest`에서
NSIS/MSI를 빌드하고 Artifact로 업로드합니다.

- 트리거: `main` push, Pull Request, 수동 실행(`workflow_dispatch`)
- Artifact 이름: `Qexam-Teacher-Windows`
- 설치 파일: `Qexam-Teacher-Setup.exe` (NSIS), `Qexam-Teacher.msi`

## Gemini API 키

1. <https://aistudio.google.com/apikey> 에서 키를 발급합니다.
2. 프로그램의 **AI 설정**에서 키를 저장합니다.
3. Windows에서는 DPAPI(`CryptProtectData`)로 암호화되어 `%APPDATA%` 하위의
   `gemini-api-key.bin`에 저장됩니다. EXE·소스·로그에 키를 포함하지 않습니다.
4. **무료(비과금) 사용 확인**을 체크해야 AI 호출이 활성화됩니다.

### 무료 사용 우선 정책

- Google은 API 키의 결제 연결 여부를 조회하는 공식 엔드포인트를 제공하지 않습니다.
  그래서 티어는 **429 응답의 할당량 지표 등 서버 증거가 있을 때만** 표시하고, 그 외에는
  `확인 불가`로 표시합니다.
- 무료 여부는 Google 가격표의 Free tier 열을 기준으로 한 내장 카탈로그(`src/lib/gemini/catalog.ts`,
  기준일 2026-11-24)로 판별합니다. 카탈로그에 없는 모델은 자동 호출하지 않습니다.
- 유료 전용 모델(`gemini-4-carbon/neon/argon`, `gemini-3.1-pro` 등)은 라우팅에서 제외됩니다.
- 모델별 429/한도 초과 시 무료 사용이 확인된 다른 Gemini 모델로 자동 전환하고, 이미 생성된
  결과(분석 등)는 재사용합니다.
- 남은 RPM/RPD/TPM은 Google이 제공하지 않으므로 표시하지 않고, 프로그램 자체 기록만 보여줍니다.

## 저장 위치

- 프로젝트: 사용자가 선택한 `.qws` 파일 (기본 제안 위치는 앱 데이터 폴더의 `projects/`)
- 이미지 자산: `.qws` 파일 안에 data URL로 포함 → 파일 하나로 다른 PC에서 열림
- 자동 저장: 45초(설정 가능)마다 초안 저장 + 파일 경로가 있으면 파일에 직접 기록
- 사용량 기록/설정: 로컬 앱 저장소(localStorage) — 외부 전송 없음

## 알려진 제한 사항

- AI 호출은 인터넷 연결이 필요합니다. 프로젝트 편집·저장·출력은 오프라인에서 동작합니다.
- 무료 티어 쿼터는 Google이 프로젝트 단위로 관리하며 정확한 잔여량 API가 없습니다.
- 지문 분석은 앞부분 약 14,000자까지 사용합니다.
- 스캔 PDF OCR은 최대 8페이지, 이미지 OCR은 기기 성능에 따라 수 초가 걸릴 수 있습니다.
- PDF는 화면 렌더링을 이미지로 캡처해 생성하므로 벡터 텍스트 선택은 지원하지 않습니다.
- 테스트는 로직 단위(vitest)와 빌드 검증까지이며, 실제 Gemini 호출·Windows 설치·인쇄는
  유효한 API 키와 Windows 환경에서 직접 확인해야 합니다.
