import os

from src.tick_logger import TickLogger


def test_log_appends_and_load_all_groups_by_symbol(tmp_path):
    logger = TickLogger(str(tmp_path))
    logger.log("BTC_IRT", 100.0)
    logger.log("ETH_IRT", 50.0)
    logger.log("BTC_IRT", 101.0)

    series = logger.load_all()

    assert set(series.keys()) == {"BTC_IRT", "ETH_IRT"}
    assert [price for _, price in series["BTC_IRT"]] == [100.0, 101.0]
    assert [price for _, price in series["ETH_IRT"]] == [50.0]


def test_load_all_returns_empty_dict_when_directory_has_no_files(tmp_path):
    logger = TickLogger(str(tmp_path))
    assert logger.load_all() == {}


def test_load_all_skips_corrupt_lines(tmp_path):
    logger = TickLogger(str(tmp_path))
    logger.log("BTC_IRT", 100.0)

    path = os.path.join(str(tmp_path), os.listdir(str(tmp_path))[0])
    with open(path, "a", encoding="utf-8") as f:
        f.write("not valid json\n")
        f.write('{"symbol": "BTC_IRT"}\n')  # فاقد timestamp/price

    series = logger.load_all()
    assert [price for _, price in series["BTC_IRT"]] == [100.0]


def test_load_all_sorts_by_timestamp_regardless_of_write_order(tmp_path):
    logger = TickLogger(str(tmp_path))
    path = os.path.join(str(tmp_path), "2026-07-31.jsonl")
    with open(path, "w", encoding="utf-8") as f:
        f.write('{"timestamp": "2026-07-31T10:00:02", "symbol": "BTC_IRT", "price": 3}\n')
        f.write('{"timestamp": "2026-07-31T10:00:01", "symbol": "BTC_IRT", "price": 2}\n')
        f.write('{"timestamp": "2026-07-31T10:00:00", "symbol": "BTC_IRT", "price": 1}\n')

    series = logger.load_all()
    assert [price for _, price in series["BTC_IRT"]] == [1, 2, 3]
