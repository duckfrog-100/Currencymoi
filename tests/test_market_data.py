from decimal import Decimal

from currencymoi.market_data import UpbitPublicWebSocket


def test_trade_message_emits_snapshot_and_trade_tick():
    snapshots = []
    trades = []
    events = []
    client = UpbitPublicWebSocket("KRW-BTC", snapshots.append, lambda *args: trades.append(args), events.append)

    client._handle_item(
        {
            "type": "trade",
            "trade_timestamp": 1785110400000,
            "trade_price": 100000000,
            "trade_volume": 0.0002,
            "best_bid_price": 99999000,
            "best_ask_price": 100001000,
        }
    )

    assert len(snapshots) == 1
    assert snapshots[0].trade_price == Decimal("100000000")
    assert snapshots[0].best_bid == Decimal("99999000")
    assert snapshots[0].best_ask == Decimal("100001000")
    assert trades[0][1:] == (Decimal("100000000"), Decimal("0.0002"))


def test_orderbook_and_ticker_combine_into_market_snapshot():
    snapshots = []
    client = UpbitPublicWebSocket("KRW-BTC", snapshots.append, lambda *_: None, lambda *_: None)

    client._handle_item(
        {
            "type": "orderbook",
            "timestamp": 1785110400000,
            "orderbook_units": [{"ask_price": 100001000, "bid_price": 99999000}],
        }
    )
    assert snapshots == []

    client._handle_item(
        {"type": "ticker", "timestamp": 1785110400100, "trade_price": 100000000}
    )

    assert len(snapshots) == 1
    assert snapshots[0].best_ask == Decimal("100001000")


def test_client_uses_only_public_quotation_endpoint():
    assert UpbitPublicWebSocket.URL == "wss://api.upbit.com/websocket/v1"
    assert "private" not in UpbitPublicWebSocket.URL
