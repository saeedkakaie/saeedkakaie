import logging
import os
from logging.handlers import RotatingFileHandler


def setup_logger(log_level: str = "INFO", log_dir: str = "logs") -> logging.Logger:
    os.makedirs(log_dir, exist_ok=True)

    logger = logging.getLogger("tabdeal_bot")
    logger.setLevel(log_level)
    logger.handlers.clear()

    fmt = logging.Formatter(
        "%(asctime)s | %(levelname)s | %(name)s | %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
    )

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(fmt)
    logger.addHandler(console_handler)

    file_handler = RotatingFileHandler(
        os.path.join(log_dir, "bot.log"), maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    file_handler.setFormatter(fmt)
    logger.addHandler(file_handler)

    return logger
