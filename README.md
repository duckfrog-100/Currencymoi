# Currencymoi

업비트의 공개 시세를 이용해 **BTC·ETH·XRP·SOL·DOGE 5종**을 공동 가상자금 50,000원으로 운용하는 멀티코인 모의투자 프로젝트입니다.

> 실제 주문 기능이 없습니다. 거래소 API 키, 시크릿 키, 입금, 출금 또는 개인 자산 조회 기능을 사용하지 않습니다.

## 웹에서 바로 보기

GitHub Pages가 활성화된 저장소에서는 다음 주소에서 별도 설치 없이 실행됩니다.

**https://duckfrog-100.github.io/Currencymoi/**

브라우저 버전은 정적 HTML·CSS·JavaScript만 사용합니다. 가상 지갑, 거래 기록과 설정은 해당 브라우저의 `localStorage`에만 저장됩니다.

GitHub 저장소에서 최초 한 번만 다음 설정이 필요합니다.

1. `Settings` → `Pages`
2. `Build and deployment`의 `Source`를 `GitHub Actions`로 선택
3. `main`에 변경 사항이 병합되면 `Deploy GitHub Pages` 워크플로가 자동 실행

## 브라우저 버전 주요 기능

- BTC·ETH·XRP·SOL·DOGE 5개 원화 마켓 동시 감시
- 모든 코인이 공동으로 사용하는 가상자금 50,000원
- 최대 2종 동시 보유
- 종목당 수수료 포함 최대 현금 사용액 20,000원
- 매수 후 최소 현금 10,000원 유지
- 최소 가상 주문금액 5,000원
- 기본 거래 수수료 0.05%, 화면에서 0.00~1.00% 범위로 변경 가능
- 매수는 최우선 매도호가, 매도는 최우선 매수호가 기준
- 기본 슬리피지 0.02% 반영
- 수수료 포함 매수 비용, 매도 후 순입금액, 누적 수수료와 손익 표시
- 이동평균 돌파 강도 50점 + 최근 상승률 30점 + 거래량 증가율 20점의 복합 점수
- 매도 신호를 먼저 처리한 뒤 점수가 높은 매수 후보부터 선택
- 포트폴리오 화면과 코인별 상세 화면
- 가격·이동평균·가상 체결 지점 차트
- 반응형 모바일 화면

## 시세 연결 방식

### WebSocket 우선

브라우저가 업비트 공개 WebSocket에 한 번 연결해 5개 마켓의 현재가, 체결과 호가를 함께 구독합니다.

### 공개 REST 대체 연결

WebSocket 연결이 반복 실패하면 오프라인 데모로 강제 전환하지 않습니다. 대신 5개 마켓을 한 번에 조회하는 공개 REST 방식으로 자동 전환합니다.

- 약 10.5초마다 호가와 현재가 요청을 교대로 실행
- 각 정보는 약 21초 간격으로 갱신
- 화면에 `공개 시세 · 약 21초 갱신`으로 표시
- 마켓별 현재가·최우선 매수호가·최우선 매도호가가 모두 유효할 때만 가상 주문 허용

### 오프라인 데모

오프라인 데모는 실제 시세가 아닌 합성 가격입니다.

- 5초봉 SMA 3/7
- 공개 시세 지갑과 별도의 `localStorage`에 저장
- 데모 거래가 공개 시세 거래 내역이나 손익을 변경하지 않음
- 화면에 `오프라인 데모 · 합성 시세`로 명확히 표시

## 공동 지갑과 체결 규칙

```text
시작 가상자금          50,000원
최대 동시 보유              2종
종목당 총 현금 사용액   20,000원
최소 잔여 현금          10,000원
최소 주문금액            5,000원
```

20,000원 매수 한도에는 수수료가 포함됩니다.

```text
코인 매수금액 = floor(20,000 ÷ (1 + 수수료율))
매수 수수료   = floor(코인 매수금액 × 수수료율)
총 현금 차감  = 코인 매수금액 + 매수 수수료
```

매도할 때는 보유 수량을 전량 가상 매도하고, 매도대금에서 매도 수수료를 차감합니다.

## 복합 점수

새로운 이동평균 상향 교차가 발생한 코인만 매수 후보가 됩니다.

```text
복합 점수
= 이동평균 돌파 강도 50점
+ 최근 3개 봉 가격 상승률 30점
+ 최근 거래량 증가율 20점
```

같은 주기에 여러 신호가 발생하면 다음 순서로 처리합니다.

1. 보유 종목의 매도 신호 처리
2. 남은 현금과 보유 가능 슬롯 재계산
3. 매수 후보를 복합 점수순으로 정렬
4. 동점이면 BTC → ETH → XRP → SOL → DOGE 순서 적용
5. 최대 2종 또는 최소 현금 조건에 도달할 때까지 가상 매수

## 안전 범위

Currencymoi는 다음 기능을 의도적으로 포함하지 않습니다.

- 실제 매수·매도 주문
- 업비트 개인 자산·주문 조회
- API 키 또는 JWT 인증
- 입금·출금·자산 보관
- 레버리지·선물·공매도
- 수익 보장 또는 투자 자문

이동평균과 복합 점수는 기능 시연을 위한 단순 규칙이며 실제 수익성을 의미하지 않습니다.

## 로컬 Python 앱

기존 Python·Streamlit 버전은 로컬 단일 BTC 모의투자 도구로 유지됩니다. GitHub Pages의 멀티코인 브라우저 버전과 지갑·거래 기록을 공유하지 않습니다.

### 실행 환경

- Python 3.11 이상
- Windows, macOS 또는 Linux

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
streamlit run app.py
```

Windows PowerShell에서는 가상환경 활성화 명령으로 `\.venv\Scripts\Activate.ps1`을 사용합니다.

## 테스트

```bash
pip install -r requirements-dev.txt
python -m pytest -q
python -m compileall -q currencymoi app.py
node --test web-tests/*.test.mjs
for file in docs/*.mjs; do node --check "$file"; done
```

브라우저 핵심 테스트는 외부 네트워크에 접속하지 않고 고정된 가짜 시세를 사용합니다.

## 프로젝트 구조

```text
Currencymoi/
├─ app.py                         # 로컬 Streamlit 단일 BTC 앱
├─ currencymoi/                   # Python 모의투자 엔진
├─ docs/                          # GitHub Pages 멀티코인 앱
│  ├─ index.html                  # 포트폴리오·코인 상세 화면
│  ├─ styles.css                  # 반응형 UI
│  ├─ core.mjs                    # 봉·이동평균 공통 로직
│  ├─ markets.mjs                 # 5개 마켓 메타데이터
│  ├─ scoring.mjs                 # 복합 점수 계산
│  ├─ portfolio.mjs               # 공동 지갑·수수료·포지션
│  ├─ decision.mjs                # 매도 우선·점수순 매수
│  ├─ feed.mjs                    # WebSocket·배치 REST 시세
│  ├─ state.mjs                   # 공개·데모 상태 저장 및 이전
│  ├─ chart.mjs                   # 선택 코인 차트
│  └─ app.mjs                     # 화면과 엔진 연결
├─ tests/                         # Python 테스트
├─ web-tests/                     # 브라우저 로직·DOM 테스트
├─ data/                          # 로컬 Python 실행 시 생성
├─ requirements.txt
└─ requirements-dev.txt
```

## 데이터 저장

- 공개 시세 포트폴리오: `currencymoi.portfolio.public.v2`
- 오프라인 데모 포트폴리오: `currencymoi.portfolio.demo.v2`
- 로컬 Python 버전: `data/currencymoi.db`

페이지를 다시 열면 자동매매는 안전을 위해 항상 일시정지 상태로 복구됩니다.
