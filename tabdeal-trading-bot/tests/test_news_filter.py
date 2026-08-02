from unittest.mock import Mock, patch

from src.news_filter import NewsFilter


def test_disabled_returns_neutral_without_calling_api():
    nf = NewsFilter(enabled=False)
    assert nf.enabled is False
    assert nf.sentiment("BTC") == 0.0


@patch("src.news_filter.requests.get")
def test_disabled_never_calls_requests(mock_get):
    nf = NewsFilter(enabled=False)
    nf.sentiment("BTC")
    mock_get.assert_not_called()


@patch("src.news_filter.requests.get")
def test_positive_keyword_yields_positive_score(mock_get):
    mock_get.return_value = Mock(
        json=lambda: {"Data": [{"title": "btc partnership announced with major bank"}]},
        raise_for_status=lambda: None,
    )
    nf = NewsFilter(enabled=True)
    assert nf.sentiment("BTC") > 0


@patch("src.news_filter.requests.get")
def test_negative_keyword_yields_negative_score(mock_get):
    mock_get.return_value = Mock(
        json=lambda: {"Data": [{"title": "exchange hacked, funds stolen"}]},
        raise_for_status=lambda: None,
    )
    nf = NewsFilter(enabled=True)
    assert nf.sentiment("XYZ") < 0


@patch("src.news_filter.requests.get")
def test_word_boundary_avoids_false_positive_substring_match(mock_get):
    # "ban" نباید داخل "bank" مچ بشه
    mock_get.return_value = Mock(
        json=lambda: {"Data": [{"title": "btc partnership announced with major bank"}]},
        raise_for_status=lambda: None,
    )
    nf = NewsFilter(enabled=True)
    assert nf.sentiment("BTC") > 0


@patch("src.news_filter.requests.get")
def test_no_posts_is_neutral(mock_get):
    mock_get.return_value = Mock(json=lambda: {"Data": []}, raise_for_status=lambda: None)
    nf = NewsFilter(enabled=True)
    assert nf.sentiment("BTC") == 0.0


@patch("src.news_filter.requests.get")
def test_result_is_cached_within_ttl(mock_get):
    mock_get.return_value = Mock(
        json=lambda: {"Data": [{"title": "neutral headline about markets"}]},
        raise_for_status=lambda: None,
    )
    nf = NewsFilter(enabled=True, cache_minutes=30)
    nf.sentiment("BTC")
    nf.sentiment("BTC")
    assert mock_get.call_count == 1


@patch("src.news_filter.requests.get", side_effect=Exception("network error"))
def test_network_error_returns_neutral(mock_get):
    nf = NewsFilter(enabled=True)
    assert nf.sentiment("BTC") == 0.0


@patch("src.news_filter.requests.get")
def test_optional_api_key_is_passed_through(mock_get):
    mock_get.return_value = Mock(json=lambda: {"Data": []}, raise_for_status=lambda: None)
    nf = NewsFilter(enabled=True, api_key="my-key")
    nf.sentiment("BTC")
    _, kwargs = mock_get.call_args
    assert kwargs["params"]["api_key"] == "my-key"


@patch("src.news_filter.requests.get")
def test_no_api_key_omits_param(mock_get):
    mock_get.return_value = Mock(json=lambda: {"Data": []}, raise_for_status=lambda: None)
    nf = NewsFilter(enabled=True)
    nf.sentiment("BTC")
    _, kwargs = mock_get.call_args
    assert "api_key" not in kwargs["params"]
