"""HEMIS'da JSHSHIR bo'yicha qidirish mumkinmi — qo'lda sinash uchun.

    python3 backend_fastapi/scripts/hemis_pinfl_probe.py <JSHSHIR> [<JSHSHIR> ...]

Root `.env` dagi HEMIS_API_URL va HEMIS_API_TOKEN ishlatiladi. Har bir usul uchun
nechta yozuv topilgani, topilganining ID/ismi va JSHSHIR javobning QAYSI maydonida
turgani chiqariladi. HEMIS'ga hech narsa yozilmaydi.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import requests

ENV = Path(__file__).resolve().parents[2] / ".env"


def load_env() -> None:
    if not ENV.exists():
        return
    for line in ENV.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def paths_with(value: object, needle: str, prefix: str = "") -> list[str]:
    """JSHSHIR qaysi maydon(lar)da turgani: `passport_pin`, `documents[0].number` ..."""
    found: list[str] = []
    if isinstance(value, dict):
        for k, v in value.items():
            found += paths_with(v, needle, f"{prefix}.{k}" if prefix else str(k))
    elif isinstance(value, list):
        for i, v in enumerate(value):
            found += paths_with(v, needle, f"{prefix}[{i}]")
    elif needle in str(value):
        found.append(prefix)
    return found


def suspicious_keys(value: object, prefix: str = "") -> list[str]:
    """Nomi JSHSHIR/pasportga o'xshagan maydonlar (qiymatidan qat'i nazar)."""
    out: list[str] = []
    if isinstance(value, dict):
        for k, v in value.items():
            path = f"{prefix}.{k}" if prefix else str(k)
            if any(s in k.lower() for s in ("pin", "passport", "jshshir", "document")):
                out.append(path)
            out += suspicious_keys(v, path)
    elif isinstance(value, list) and value:
        out += suspicious_keys(value[0], f"{prefix}[0]")
    return out


def main() -> None:
    load_env()
    base = os.environ.get("HEMIS_API_URL", "").rstrip("/")
    token = os.environ.get("HEMIS_API_TOKEN", "")
    if not base or not token:
        sys.exit(f"HEMIS_API_URL / HEMIS_API_TOKEN topilmadi ({ENV})")
    pinfls = sys.argv[1:]
    if not pinfls:
        sys.exit(__doc__)
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}

    def get(path: str, **params: object) -> dict:
        res = requests.get(base + path, headers=headers, params=params, timeout=60)
        try:
            return res.json()
        except ValueError:
            return {"success": False, "error": f"HTTP {res.status_code}, JSON emas"}

    attempts = [
        ("employee-list search", "/data/employee-list", {"type": "all", "search": None}),
        ("employee-list pinfl", "/data/employee-list", {"type": "all", "pinfl": None}),
        ("employee-list passport_pin", "/data/employee-list", {"type": "all", "passport_pin": None}),
        ("student-list search", "/data/student-list", {"search": None}),
        ("student-list pinfl", "/data/student-list", {"pinfl": None}),
        ("student-list passport_pin", "/data/student-list", {"passport_pin": None}),
        ("student-info pinfl", "/data/student-info", {"pinfl": None}),
        ("student-info passport_pin", "/data/student-info", {"passport_pin": None}),
    ]

    for pinfl in pinfls:
        print(f"\n===== JSHSHIR ...{pinfl[-4:]} =====")
        for label, path, params in attempts:
            q = {k: (pinfl if v is None else v) for k, v in params.items()}
            body = get(path, limit=5, **q)
            data = body.get("data")
            if not body.get("success", True) or not data:
                print(f"  {label:28} -> topilmadi ({body.get('error') or 'bo`sh'})")
                continue
            items = data.get("items") if isinstance(data, dict) and "items" in data else [data]
            total = (data.get("pagination") or {}).get("totalCount", len(items)) if isinstance(data, dict) else len(items)
            note = "  <-- filtr ishlamadi (hamma ro'yxat)" if total > 50 else ""
            print(f"  {label:28} -> {total} ta{note}")
            if total > 50:
                continue
            for item in items[:5]:
                ident = item.get("employee_id_number") or item.get("student_id_number") or item.get("id")
                print(f"      ID={ident}  {item.get('full_name', '')}")
                where = paths_with(item, pinfl)
                print(f"      JSHSHIR turgan maydon: {', '.join(where) or 'javobda yo`q'}")
                keys = suspicious_keys(item)
                if keys:
                    print(f"      pin/pasport nomli maydonlar: {', '.join(keys)}")


if __name__ == "__main__":
    main()
