from decimal import Decimal

import pytest

from currencymoi.config import BotConfig, TradingMode


def test_normal_mode_defaults_are_safe():
    config = BotConfig.for_mode(TradingMode.NORMAL)

    assert config.market == "KRW-BTC"
    assert config.starting_cash == Decimal("50000")
    assert config.buy_budget == Decimal("40000")
    assert config.minimum_cash == Decimal("10000")
    assert config.candle_seconds == 60
    assert (config.fast_period, config.slow_period) == (5, 20)
    assert config.fee_rate == Decimal("0.0005")
    assert config.slippage_rate == Decimal("0.0002")


def test_demo_mode_uses_short_intervals():
    config = BotConfig.for_mode(TradingMode.DEMO)

    assert config.candle_seconds == 5
    assert (config.fast_period, config.slow_period) == (3, 7)


def test_config_rejects_invalid_period_order():
    with pytest.raises(ValueError, match="fast_period"):
        BotConfig(fast_period=5, slow_period=5)


def test_config_rejects_buy_budget_that_breaks_minimum_cash():
    with pytest.raises(ValueError, match="minimum_cash"):
        BotConfig(starting_cash=Decimal("50000"), buy_budget=Decimal("45000"), minimum_cash=Decimal("10000"))
