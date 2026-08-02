import os

from src.config import Config


def test_load_picks_up_changed_env_values_across_repeated_calls(tmp_path, monkeypatch):
    """
    رگرسیون: چون Config.load ممکن است چندین بار در طول عمر یک پردازش طولانی
    (مثلا سرور Flask) صدا زده شود، باید هر بار مقادیر واقعی فایل .env را
    بخواند، نه مقدار کش‌شده‌ی os.environ از اولین بار.
    """
    monkeypatch.delenv("TABDEAL_API_KEY", raising=False)
    monkeypatch.delenv("TABDEAL_API_SECRET", raising=False)

    env_path = os.path.join(tmp_path, ".env")
    with open(env_path, "w", encoding="utf-8") as f:
        f.write("TABDEAL_API_KEY=\nTABDEAL_API_SECRET=\nDRY_RUN=true\n")

    first = Config.load(env_path)
    assert first.api_key == ""

    with open(env_path, "w", encoding="utf-8") as f:
        f.write("TABDEAL_API_KEY=abc123\nTABDEAL_API_SECRET=secret456\nDRY_RUN=true\n")

    second = Config.load(env_path)
    assert second.api_key == "abc123"
    assert second.api_secret == "secret456"
