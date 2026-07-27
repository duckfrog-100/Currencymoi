from __future__ import annotations

import json
import threading
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Callable

from .models import MarketSnapshot

SnapshotCallback = Callable[[MarketSnapshot], None]
TradeCallback = Callable[[datetime, Decimal, Decimal], None]
EventCallback = Callable[[str], None]


class UpbitPublicWebSocket:
    """Reconnects to Upbit's public quotation WebSocket only.

    This adapter deliberately contains no authentication or private endpoint.
    """

    URL = "wss://api.upbit.com/websocket/v1"

    def __init__(
        self,
        market: str,
        on_snapshot: SnapshotCallback,
        on_trade: TradeCallback,
        on_event: EventCallback,
    ) -> None:
        self.market = market.upper()
        self.on_snapshot = on_snapshot
        self.on_trade = on_trade
        self.on_event = on_event
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._ws = None
        self._trade_price: Decimal | None = None
        self._best_bid: Decimal | None = None
        self._best_ask: Decimal | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="upbit-public-feed", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._ws is not None:
            try:
                self._ws.close()
            except Exception:
                pass

    def _run(self) -> None:
        try:
            import websocket
        except ImportError:
            self.on_event("websocket-client 패키지가 설치되지 않아 시세 연결을 시작할 수 없습니다.")
            return

        delay = 1
        while not self._stop.is_set():
            try:
                self._ws = websocket.WebSocketApp(
                    self.URL,
                    on_open=self._on_open,
                    on_message=self._on_message,
                    on_error=self._on_error,
                    on_close=self._on_close,
                )
                self._ws.run_forever(ping_interval=30, ping_timeout=10)
            except Exception as exc:
                self.on_event(f"시세 연결 예외: {exc}")
            if self._stop.is_set():
                break
            self.on_event(f"시세 연결이 끊어져 {delay}초 후 재연결합니다.")
            time.sleep(delay)
            delay = min(delay * 2, 30)

    def _on_open(self, ws) -> None:
        request = [
            {"ticket": str(uuid.uuid4())},
            {"type": "ticker", "codes": [self.market], "is_only_realtime": True},
            {"type": "trade", "codes": [self.market], "is_only_realtime": True},
            {"type": "orderbook", "codes": [f"{self.market}.5"], "is_only_realtime": True},
            {"format": "DEFAULT"},
        ]
        ws.send(json.dumps(request))
        self.on_event("업비트 공개 실시간 시세에 연결되었습니다.")

    def _on_message(self, _ws, message: bytes | str) -> None:
        try:
            if isinstance(message, bytes):
                message = message.decode("utf-8")
            payload = json.loads(message)
            messages = payload if isinstance(payload, list) else [payload]
            for item in messages:
                if isinstance(item, dict):
                    self._handle_item(item)
        except (UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError, InvalidOperation) as exc:
            self.on_event(f"유효하지 않은 시세 메시지를 무시했습니다: {exc}")

    def _handle_item(self, item: dict) -> None:
        kind = item.get("type")
        if kind == "orderbook":
            units = item.get("orderbook_units") or []
            if not units:
                return
            self._best_ask = Decimal(str(units[0]["ask_price"]))
            self._best_bid = Decimal(str(units[0]["bid_price"]))
            timestamp = self._from_millis(item["timestamp"])
            self._emit_snapshot(timestamp)
            return

        if kind == "ticker":
            self._trade_price = Decimal(str(item["trade_price"]))
            timestamp = self._from_millis(item["timestamp"])
            self._emit_snapshot(timestamp)
            return

        if kind == "trade":
            timestamp = self._from_millis(item["trade_timestamp"])
            price = Decimal(str(item["trade_price"]))
            volume = Decimal(str(item["trade_volume"]))
            self._trade_price = price
            if item.get("best_bid_price") is not None:
                self._best_bid = Decimal(str(item["best_bid_price"]))
            if item.get("best_ask_price") is not None:
                self._best_ask = Decimal(str(item["best_ask_price"]))
            self._emit_snapshot(timestamp)
            self.on_trade(timestamp, price, volume)

    @staticmethod
    def _from_millis(value: int | float | str) -> datetime:
        return datetime.fromtimestamp(int(value) / 1000, tz=timezone.utc)

    def _emit_snapshot(self, timestamp: datetime) -> None:
        if self._trade_price is None or self._best_bid is None or self._best_ask is None:
            return
        if self._trade_price <= 0 or self._best_bid <= 0 or self._best_ask <= 0:
            return
        self.on_snapshot(
            MarketSnapshot(
                timestamp=timestamp,
                trade_price=self._trade_price,
                best_bid=self._best_bid,
                best_ask=self._best_ask,
                connected=True,
            )
        )

    def _on_error(self, _ws, error) -> None:
        self.on_event(f"업비트 시세 오류: {error}")

    def _on_close(self, _ws, _status_code, _message) -> None:
        self.on_event("업비트 공개 시세 연결이 종료되었습니다.")
