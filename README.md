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
4. 저장하면 키 유효성·모델 목록·티어 증거(있을 때만)·가격을 자동 진단합니다. 기본 정책은‘무료 우선’이며,
   유료 모델까지 쓰려면 AI 설정에서‘유료 모델 사용 허용’과 예산을 설정합니다.

### 티어 · 모델 · 비용 정책

- **티어**: Google은 API 키의 결제 연결 여부/티어를 조회하는 공식 엔드포인트를 제공하지 않습니다.
  그래서 Free/Tier 1/2/3은 **429 응답의 할당량 지표에 표기된 경우에만** 표시하고, 그 외에는
  `확인 불가`로 표시합니다. 결제 연결 여부는 티어와 별개의 정보로 취급합니다.
- **모델 목록**: `models.list`에서 실제로 조회된 모델만 표시합니다. 가격은 API로 제공되지 않으므로
  가격표 스냅샷(`src/lib/gemini/pricing.ts`, 기준일 2026-11-24)을 사용합니다.
- **무료 여부**: 가격표의 Free tier 열을 기준으로 한 카탈로그(`src/lib/gemini/catalog.ts`)로 판별합니다.
- **기본 정책**: `무료 우선` · 유료 모델 미허용. 이 모드에서는 무료 티어 모델만 호출하며 비용을 $0으로
  기록합니다(무료 티어 전제).
- **유료 모델 허용**: AI 설정에서 켜면 접근 가능한 무료·유료 모델을 모두 후보로 쓰되, **가격이 확인된
  모델만** 호출합니다. 가격 미확인 모델은 비용을 확인할 수 없으므로 자동 호출하지 않습니다.
- **모델 선택 모드**: 무료 우선 / 자동 / 품질 우선 / 비용 절약 / 속도 우선. 모든 모드는 작업 적합도
  (지문 분석·해석·쉬운 설명·단어·워크북·답안지별 가중치)를 기본으로 사용합니다.
- **자동 전환**: 429·일일 한도·모델 장애·시간 초과·접근 불가 시 다음 후보로 전환합니다. 유료 모드에서는
  무료·유료 모델이 함께 후보가 되지만, 매 전환마다 가격·티어·예산 조건을 다시 검사합니다.
- **예산**: 일일/월간/요청당 최대 비용(USD)을 설정하고, 초과가 예상되면 호출을 차단합니다. 유료 요청 전
  예상 비용 확인 창을 띄우고(끄기 가능), 거절하면 무료 모델만으로 계속합니다.
- **비용 기록**: 응답의 `usageMetadata` 토큰 수와 가격표로 실제 비용을 다시 계산해 로컬에 기록합니다.
  실제 청구 금액은 Google Cloud 결제 콘솔에서 확인해야 하며, 앱의 값은 추정치입니다.
- 남은 RPM/RPD/TPM은 Google이 제공하지 않으므로 표시하지 않고, 프로그램 자체 기록만 보여줍니다.

## 대용량 파일 처리

파일 크기·페이지 수·개수에 고정 제한을 두지 않습니다. 대신 PC 자원을 측정해 처리량을 정합니다.

- **자원 기반 예산** (`src/lib/ingest/resources.ts`): `navigator.deviceMemory`, CPU 코어 수,
  JS 힙 사용률로 동시 처리 수 · OCR 배율 · 캔버스 최대 픽셀 · Gemini 구간 크기를 정하고,
  힙 사용률이 88%를 넘으면 자동으로 한 단계 낮춥니다.
- **PDF 3분류** (`src/lib/ingest/pdf.ts`): 페이지별로 텍스트/스캔/혼합/빈 페이지를 판별해
  텍스트는 로컬에서 바로 추출하고, 스캔·혼합 페이지만 OCR합니다. 페이지 범위(`1-5, 8`)를
  지정하면 그 페이지만 처리합니다.
- **페이지 단위 처리**: 완료된 페이지마다 IndexedDB에 저장(`src/lib/ingest/checkpoint.ts`)하므로
  일시정지·취소·앱 종료 후에도 같은 파일을 다시 첨부하면 완료 페이지만 건너뛰고 이어서 처리합니다.
  실패한 페이지만 따로 재시도할 수 있습니다.
- **이미지** (`src/lib/ingest/images.ts`): EXIF 방향을 보정하고, 메모리 예산에 맞춰 OCR용
  복사본만 축소합니다(원본 파일 불변). 세로로 긴 이미지는 겹침을 둔 조각으로 나눠 OCR한 뒤
  중복 줄을 제거합니다.
- **텍스트 파일**: 스트리밍으로 읽어 대용량 TXT에서도 UI가 멈추지 않습니다.
- **Gemini**: 지문이 모델 입력 한도를 넘으면 문단/문장 경계에서 나누어 구간별로 분석하고,
  구간 결과를 캐시한 뒤 하나의 분석으로 통합합니다(`analysisPlan`, `analyzeLongPassage`).
  모델 자동 선택·자동 전환 위에 티어/가격/예산 게이트가 추가됩니다.

## 저장 위치

- 프로젝트: 사용자가 선택한 `.qws` 파일 (기본 제안 위치는 앱 데이터 폴더의 `projects/`)
- 이미지 자산: `.qws` 파일 안에 data URL로 포함 → 파일 하나로 다른 PC에서 열림
- 자동 저장: 45초(설정 가능)마다 초안 저장 + 파일 경로가 있으면 파일에 직접 기록
- 사용량 기록/설정: 로컬 앱 저장소(localStorage) — 외부 전송 없음

## 알려진 제한 사항

- AI 호출은 인터넷 연결이 필요합니다. 프로젝트 편집·저장·출력은 오프라인에서 동작합니다.
- 무료 티어 쿼터는 Google이 프로젝트 단위로 관리하며 정확한 잔여량 API가 없습니다.
- 지문 분석은 긴 문서를 구간으로 나누어 처리합니다. 그 외 생성 기능(쉬운 설명·단어·워크북·답안지)은
  지문 앞부분 약 14,000자를 사용합니다.
- 스캔 PDF OCR은 선택한 페이지 전체를 처리하므로 페이지가 많으면 시간이 오래 걸립니다.
  필요한 페이지만 골라 처리하는 것을 권장합니다.
- PDF.js는 파일 전체를 메모리에 올립니다. 수백 MB급 PDF는 RAM이 충분한 PC에서 처리해 주세요.
- 25만 자를 넘는 추출 결과는 자동으로 지문에 넣지 않고 ‘지문에 넣기’ 버튼으로 반영합니다
  (거대한 텍스트 편집 영역으로 인한 UI 지연 방지).
- PDF는 화면 렌더링을 이미지로 캡처해 생성하므로 벡터 텍스트 선택은 지원하지 않습니다.
- 테스트는 로직 단위(vitest)와 빌드 검증까지이며, 실제 Gemini 호출·Windows 설치·인쇄는
  유효한 API 키와 Windows 환경에서 직접 확인해야 합니다.
