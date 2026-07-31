import os

from src.position import Position
from src.position_store import PositionStore


def test_save_and_load_round_trip(tmp_path):
    store = PositionStore(os.path.join(tmp_path, "open_positions.json"))
    positions = {
        "BTC_IRT": Position(entry_price=100, quantity=1.5, stop_loss_percent=2, take_profit_percent=3),
        "ETH_IRT": Position(entry_price=50, quantity=3, stop_loss_percent=4, take_profit_percent=6),
    }

    store.save(positions)
    loaded = store.load()

    assert loaded.keys() == positions.keys()
    assert loaded["BTC_IRT"].entry_price == 100
    assert loaded["BTC_IRT"].quantity == 1.5
    assert loaded["ETH_IRT"].stop_loss_percent == 4


def test_save_and_load_round_trip_preserves_highest_price(tmp_path):
    """
    رگرسیون برای حد ضرر متحرک: اگر بالاترین قیمت دیده‌شده با هر ری‌استارت
    به قیمت ورود برگردد، محافظت از سودی که قبلا به‌دست آمده از دست می‌رود.
    """
    store = PositionStore(os.path.join(tmp_path, "open_positions.json"))
    position = Position(entry_price=100, quantity=1, stop_loss_percent=2, take_profit_percent=3)
    position.update_highest_price(150)

    store.save({"BTC_IRT": position})
    loaded = store.load()

    assert loaded["BTC_IRT"].highest_price == 150


def test_load_returns_empty_dict_when_file_missing(tmp_path):
    store = PositionStore(os.path.join(tmp_path, "missing.json"))
    assert store.load() == {}


def test_load_returns_empty_dict_on_corrupt_file(tmp_path):
    path = os.path.join(tmp_path, "open_positions.json")
    with open(path, "w", encoding="utf-8") as f:
        f.write("not valid json")

    store = PositionStore(path)
    assert store.load() == {}


def test_save_overwrites_previous_content(tmp_path):
    path = os.path.join(tmp_path, "open_positions.json")
    store = PositionStore(path)

    store.save({"A_IRT": Position(entry_price=1, quantity=1, stop_loss_percent=1, take_profit_percent=1)})
    store.save({"B_IRT": Position(entry_price=2, quantity=2, stop_loss_percent=2, take_profit_percent=2)})

    loaded = store.load()
    assert list(loaded.keys()) == ["B_IRT"]


def test_save_empty_positions_clears_file(tmp_path):
    path = os.path.join(tmp_path, "open_positions.json")
    store = PositionStore(path)

    store.save({"A_IRT": Position(entry_price=1, quantity=1, stop_loss_percent=1, take_profit_percent=1)})
    store.save({})

    assert store.load() == {}
