from app.services import dean_access as da


def test_password_comes_from_env(monkeypatch):
    monkeypatch.setenv("DEAN_PASSWORD_DEKAN_TPI", "secret-tpi")
    assert da.authenticate_dean("dekan_tpi", "secret-tpi") is da.DEANS["dekan_tpi"]
    assert da.authenticate_dean("DEKAN_TPI ", "secret-tpi") is da.DEANS["dekan_tpi"]
    assert da.authenticate_dean("dekan_tpi", "wrong") is None


def test_unset_password_never_allows_login(monkeypatch):
    monkeypatch.delenv("DEAN_PASSWORD_DEKAN_STOM", raising=False)
    assert da.authenticate_dean("dekan_stom", "") is None
    assert da.authenticate_dean("dekan_stom", "anything") is None
    assert da.authenticate_dean("nobody", "") is None
