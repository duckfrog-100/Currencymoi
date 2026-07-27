# Currencymoi

업비트의 **공개 실시간 KRW-BTC 시세**를 받아 50,000원의 가상 자금으로 자동매매를 시뮬레이션하는 Streamlit 웹 애플리케이션입니다.

> 실제 주문 기능이 없습니다. 거래소 API 키, 시크릿 키, 입금 또는 출금 기능을 사용하지 않습니다.

## 주요 기능

- 업비트 공개 WebSocket 기반 실시간 현재가·체결·호가 수신
- 50,000원 가상 지갑과 40,000원 기본 매수금액
- 수수료와 슬리피지를 반영한 모의 체결
- 1분봉 SMA 5/20 이동평균 교차 전략
- 거래 장면을 빠르게 확인하는 5초봉 SMA 3/7 데모 모드
- 총 평가자산, 현금, BTC 수량, 실현·평가손익, 수익률 표시
- 캔들·이동평균·가상 매수/매도 지점 차트
- 거래 내역, 판단 이유, 시스템 로그, CSV 다운로드
- SQLite 기반 상태 복원
- 같은 봉 중복 주문 및 오래된 시세 기반 주문 차단

## 안전 범위

Currencymoi는 다음 기능을 의도적으로 포함하지 않습니다.

- 실제 매수·매도 주문
- 업비트 개인 자산·주문 조회
- API 키 또는 JWT 인증
- 입금·출금·자산 보관
- 레버리지·선물·공매도
- 수익 보장 또는 투자 자문

데모 모드는 화면에서 거래 발생 과정을 확인하기 위한 짧은 주기 전략입니다. 실제 수익성을 의미하지 않습니다.

## 실행 환경

- Python 3.11 이상
- Windows, macOS 또는 Linux

## Windows PowerShell 실행

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
streamlit run app.py
```

브라우저가 자동으로 열리지 않으면 터미널에 표시되는 `http://localhost:8501` 주소로 접속합니다.

## macOS / Linux 실행

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
streamlit run app.py
```

## 사용 순서

1. 앱을 실행하고 상단의 시세 연결 상태가 `연결됨`으로 바뀌는지 확인합니다.
2. 빠르게 거래 과정을 보고 싶으면 사이드바에서 `데모` 모드를 선택하고 적용합니다.
3. `시작` 버튼을 누릅니다.
4. 완료된 봉마다 이동평균 교차 여부와 판단 이유가 기록됩니다.
5. 매수·매도 신호가 발생하면 실제 호가에 수수료와 슬리피지를 더해 가상 체결합니다.
6. 초기화하려면 봇을 일시정지하고 삭제 동의 체크 후 `50,000원으로 초기화`를 누릅니다.

## 전략 규칙

### 일반 모드

- 봉 주기: 60초
- 단기 이동평균: 5개 봉
- 장기 이동평균: 20개 봉
- 단기선 상향 돌파 + BTC 미보유: 40,000원 가상 매수
- 단기선 하향 돌파 + BTC 보유: 전량 가상 매도

### 데모 모드

- 봉 주기: 5초
- 단기 이동평균: 3개 봉
- 장기 이동평균: 7개 봉
- 나머지 체결 규칙은 일반 모드와 동일

## 테스트

```bash
pip install -r requirements-dev.txt
python -m pytest -q
python -m compileall currencymoi app.py
```

테스트는 네트워크에 접속하지 않으며 가짜 시세와 임시 SQLite 데이터베이스를 사용합니다.

## 프로젝트 구조

```text
Currencymoi/
├─ app.py
├─ currencymoi/
│  ├─ candle_builder.py
│  ├─ charts.py
│  ├─ config.py
│  ├─ engine.py
│  ├─ market_data.py
│  ├─ models.py
│  ├─ paper_broker.py
│  ├─ portfolio.py
│  ├─ repository.py
│  └─ strategy.py
├─ tests/
├─ data/                  # 실행 시 생성, DB는 Git에 포함되지 않음
├─ requirements.txt
└─ requirements-dev.txt
```

## 데이터 저장

실행 시 `data/currencymoi.db`가 생성됩니다. 가상 지갑, 완료된 봉, 전략 판단과 거래 내역을 저장하므로 앱을 재시작해도 모의 자산이 복원됩니다. 앱 재시작 시 자동매매는 안전을 위해 일시정지 상태로 복구됩니다.
