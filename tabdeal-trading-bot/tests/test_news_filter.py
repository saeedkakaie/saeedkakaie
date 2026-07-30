from unittest.mock import Mock, patch

from src.news_filter import NewsFilter


def test_disabled_without_token_returns_neutral():
    nf = NewsFilter(api_token=None)
    assert nf.enabled is False
    assert nf.sentiment("BTC") == 0.0


@patch("src.news_filter.requests.get")
def test_positive_votes_yield_positive_score(mock_get):
    mock_get.return_value = Mock(
        json=lambda: {"results": [{"title": "btc partnership announced", "votes": {"positive": 5, "negative": 1}}]},
        raise_for_status=lambda: None,
    )
    nf = NewsFilter(api_token="fake-token", cache_minutes=30)
    assert nf.sentiment("BTC") > 0


@patch("src.news_filter.requests.get")
def test_negative_keyword_pushes_score_down(mock_get):
    mock_get.return_value = Mock(
        json=lambda: {"results": [{"title": "exchange hacked, funds stolen", "votes": {}}]},
        raise_for_status=lambda: None,
    )
    nf = NewsFilter(api_token="fake-token")
    assert nf.sentiment("XYZ") < 0


@patch("src.news_filter.requests.get")
def test_no_posts_is_neutral(mock_get):
    mock_get.return_value = Mock(json=lambda: {"results": []}, raise_for_status=lambda: None)
    nf = NewsFilter(api_token="fake-token")
    assert nf.sentiment("BTC") == 0.0


@patch("src.news_filter.requests.get")
def test_result_is_cached_within_ttl(mock_get):
    mock_get.return_value = Mock(
        json=lambda: {"results": [{"title": "neutral headline", "votes": {}}]},
        raise_for_status=lambda: None,
    )
    nf = NewsFilter(api_token="fake-token", cache_minutes=30)
    nf.sentiment("BTC")
    nf.sentiment("BTC")
    assert mock_get.call_count == 1


@patch("src.news_filter.requests.get", side_effect=Exception("network error"))
def test_network_error_returns_neutral(mock_get):
    nf = NewsFilter(api_token="fake-token")
    assert nf.sentiment("BTC") == 0.0
