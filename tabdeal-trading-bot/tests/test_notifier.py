from unittest.mock import MagicMock, patch

from src.notifier import notify


def test_notify_does_nothing_when_termux_notification_unavailable():
    with patch("src.notifier.shutil.which", return_value=None), patch("src.notifier.subprocess.run") as run:
        notify("عنوان", "پیام")
        run.assert_not_called()


def test_notify_calls_termux_notification_with_title_and_content():
    with patch("src.notifier.shutil.which", return_value="/data/data/com.termux/files/usr/bin/termux-notification"), \
         patch("src.notifier.subprocess.run") as run:
        notify("عنوان", "پیام")

        run.assert_called_once()
        args = run.call_args.args[0]
        assert args[0] == "termux-notification"
        assert "--title" in args and "عنوان" in args
        assert "--content" in args and "پیام" in args


def test_notify_swallows_subprocess_errors():
    with patch("src.notifier.shutil.which", return_value="termux-notification"), \
         patch("src.notifier.subprocess.run", side_effect=OSError("boom")):
        notify("عنوان", "پیام")  # نباید خطا بالا بیاید
