"""Ruxsat tekshiruvi — `require_roles` va tashqi API kaliti.

Bu ikkisi butun backend'ning yagona avtorizatsiya darvozasi: har bir admin
endpointi `require_roles(...)` orqali himoyalanadi. Shuning uchun "ruxsat
berilmagan rol o'tib ketmasin" degan tekshiruv shu yerda, sof funksiya
darajasida qilinadi — HTTP qatlamisiz, tez va DB'siz.
"""

import os

import pytest
from fastapi import HTTPException

from app.api.deps import AuthContext, external_api_keys, require_external_api_key, require_roles


def ctx(role: str) -> AuthContext:
    # AuthContext `user` ni faqat saqlaydi, shuning uchun soxta obyekt yetarli.
    return AuthContext(user=object(), role=role)


class TestRequireRoles:
    def test_ruxsat_etilgan_rol_otadi(self):
        dep = require_roles("admin", "hodim")
        auth = ctx("hodim")
        assert dep(auth) is auth

    def test_begona_rol_403(self):
        dep = require_roles("admin")
        with pytest.raises(HTTPException) as e:
            dep(ctx("student"))
        assert e.value.status_code == 403

    def test_talaba_admin_endpointiga_kirolmaydi(self):
        # Eng xavfli holat: talaba tokeni bilan admin API'si.
        dep = require_roles("admin", "klinika_admin")
        for role in ("student", "hodim", "", "ADMIN"):
            with pytest.raises(HTTPException):
                dep(ctx(role))

    def test_rol_registri_aynan_solishtiriladi(self):
        # "Admin" != "admin" — katta harf bilan aylanib o'tish bo'lmasin.
        with pytest.raises(HTTPException):
            require_roles("admin")(ctx("Admin"))

    def test_bosh_royxat_hech_kimni_kiritmaydi(self):
        with pytest.raises(HTTPException):
            require_roles()(ctx("admin"))


class TestExternalApiKey:
    @pytest.fixture(autouse=True)
    def _clean_env(self, monkeypatch):
        monkeypatch.delenv("IMENTOR_EXTERNAL_API_KEYS", raising=False)
        monkeypatch.delenv("EXTERNAL_API_KEYS", raising=False)

    def test_sozlanmagan_bolsa_hech_kim_kirmaydi(self):
        # Fail-open bo'lmasin: kalit ro'yxati bo'sh bo'lsa endpoint YOPIQ.
        with pytest.raises(HTTPException) as e:
            require_external_api_key("nimadir")
        assert e.value.status_code == 403

    def test_togri_kalit_otadi(self, monkeypatch):
        monkeypatch.setenv("IMENTOR_EXTERNAL_API_KEYS", "k1,k2")
        assert require_external_api_key("k2") is None

    def test_atrofdagi_boshliqlar_kesiladi(self, monkeypatch):
        monkeypatch.setenv("IMENTOR_EXTERNAL_API_KEYS", " k1 , k2 ")
        assert require_external_api_key(" k1 ") is None

    def test_notogri_kalit_403(self, monkeypatch):
        monkeypatch.setenv("IMENTOR_EXTERNAL_API_KEYS", "k1")
        with pytest.raises(HTTPException):
            require_external_api_key("k9")

    def test_header_yoq(self, monkeypatch):
        monkeypatch.setenv("IMENTOR_EXTERNAL_API_KEYS", "k1")
        with pytest.raises(HTTPException):
            require_external_api_key(None)
        with pytest.raises(HTTPException):
            require_external_api_key("")

    def test_eski_nom_ham_ishlaydi(self, monkeypatch):
        monkeypatch.setenv("EXTERNAL_API_KEYS", "legacy")
        assert external_api_keys() == frozenset({"legacy"})

    def test_bosh_qiymatlar_royxatga_kirmaydi(self, monkeypatch):
        monkeypatch.setenv("IMENTOR_EXTERNAL_API_KEYS", "k1,,  ,k2")
        assert external_api_keys() == frozenset({"k1", "k2"})


def test_env_o_zgarishi_darhol_kuchga_kiradi(monkeypatch):
    # Kalitlar modul yuklanganda emas, har chaqiruvda o'qiladi — kalitni
    # bekor qilish uchun konteynerni qayta ishga tushirish shart emas.
    monkeypatch.setenv("IMENTOR_EXTERNAL_API_KEYS", "eski")
    assert "eski" in external_api_keys()
    monkeypatch.setenv("IMENTOR_EXTERNAL_API_KEYS", "yangi")
    assert external_api_keys() == frozenset({"yangi"})
    assert os.environ["IMENTOR_EXTERNAL_API_KEYS"] == "yangi"
