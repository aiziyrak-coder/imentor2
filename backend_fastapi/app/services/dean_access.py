from __future__ import annotations

import os
import secrets
from dataclasses import dataclass


@dataclass(frozen=True)
class DeanAccess:
    login: str
    label: str
    departments: tuple[str, ...]

    @property
    def password(self) -> str:
        """Parol kodda emas — server `.env`da: `DEAN_PASSWORD_<LOGIN>`
        (masalan `DEAN_PASSWORD_DEKAN_TPI`). Bo'sh bo'lsa bu dekan kira olmaydi."""
        return (os.environ.get(f"DEAN_PASSWORD_{self.login.upper()}") or "").strip()


DEANS: dict[str, DeanAccess] = {
    "dekan_davolash": DeanAccess(
        login="dekan_davolash",
        label="Davolash ishi dekani",
        departments=(
            "Akusherlik va ginekologiya",
            "Dermatovenerologiya va allergologiya",
            "Endokrinologiya gematologiya va ftizatriya",
            "Fakultet va gospital jarrohlik",
            "Fakultativ va gospital jarrohlik",
            "Gospital terapiya",
            "Ichki kasalliklar propedevtikasi kafedrasi",
            "Ichki kasallilar propedevtikasi",
            "Nevrologiya va psixatriya",
            "Nevrologiya va Psixiatriya",
            "Normal anatomiya",
            "Patologik fiziologiya va patologik anatomiya",
            "Terapiya UASH",
            "Terapiya yo'nalishidagi fanlar",
            "Travmatologiya va ortopediya",
            "Travmatologiya va ortapediya",
            "Umumiy xirurgiya",
            "Urologiya va onkologiya",
            "Xalq tabobati va Farmakologiya",
            "Xalq tabobati va farmakologiya kafedrasi",
        ),
    ),
    "dekan_tpi": DeanAccess(
        login="dekan_tpi",
        label="Tibbiy profilaktika ishi dekani",
        departments=(
            "Kommunal va mehnat gigiyenasi",
            "Ovqatlanish, bolalar va o�smirlar gigiyenasi",
            "Ovqatlanish, Bolalar va o 'smirlar gigienasi",
            "Epidemiologiya va yuqumli kasalliklar, hamshiralik ishi",
            "Epidemiologiya va yuqumli kasalliklar hamshiralik ishi",
            "Mikrobiologiya,virusologiya,immunologiya",
            "Preventiv",
        ),
    ),
    "dekan_pediatriya": DeanAccess(
        login="dekan_pediatriya",
        label="Pediatriya dekani",
        departments=(
            "Pediatriya",
            "Pediatriya 1",
            "Pediatriya 2",
            "Fiziologiya",
            "Gistologiya va biologiya",
            "GISTOLOGIYA BIOLOGIYA",
            "Tibbiy va biologik kimyo",
        ),
    ),
    "dekan_stom": DeanAccess(
        login="dekan_stom",
        label="Stomatologiya dekani",
        departments=(
            "Stomatologiya va otorinolaringologiya",
            "Stomatologiya va otorinoloringologiya",
            "Biotibbiyot muhandisligi, biofizika va axborot texnologiyalari",
            "Ijtimoiy fanlar",
            "Lotin tili",
            "Lotin tilli, pedagogika va psixalogiya",
            "O�zbek va xorijiy tillar",
            "O'zbek va xorijiy tillar kafedrasi",
        ),
    ),
}


def authenticate_dean(login: str, password: str) -> DeanAccess | None:
    dean = DEANS.get((login or "").strip().lower())
    if dean is None:
        return None
    expected = dean.password
    # Parol sozlanmagan bo'lsa bo'sh parol bilan kirib bo'lmasin.
    if not expected or not secrets.compare_digest(password or "", expected):
        return None
    return dean


def rector_context(payload: dict) -> dict:
    if payload.get("scope") == "rector-report":
        return {
            "kind": payload.get("kind") or payload.get("role") or "rektor",
            "login": payload.get("login") or "rektor",
            "label": payload.get("label") or "Rektor",
            "departments": [str(x).strip() for x in (payload.get("departments") or []) if str(x).strip()],
        }
    return {"kind": "admin", "login": "admin", "label": "Admin", "departments": []}


def allowed_departments(ctx: dict | None) -> list[str]:
    return [str(x).strip() for x in ((ctx or {}).get("departments") or []) if str(x).strip()]
