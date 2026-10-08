"""cam.fermi.uz: xodimni JSHSHIR bo'yicha tasdiqlash (docs/cam-fermi-verify-staff.md).

iMentor JSHSHIRni (va bo'lsa yuz kadrlarini) cam.fermi.uz'ga server-to-server
yuboradi; `verified=true` kelsa xodim tizimga kiritiladi. Bu modul faqat HTTP
qismi — hisob tanlash/ochish `cam_login` da.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

import requests

from app.core.config import get_settings

ENDPOINT = "/api/external/imentor/verify-staff"
PERSON_FIELDS = (
    "id", "pinfl", "full_name", "last_name", "first_name", "middle_name",
    "position", "department", "hemis_employee_id", "phone",
)


class CamUnavailable(Exception):
    """cam.fermi.uz sozlanmagan, javob bermadi yoki kutilmagan javob qaytardi."""


class CamRateLimited(Exception):
    pass


@dataclass
class CamResult:
    verified: bool
    reason: str = ""
    person: dict[str, str] = field(default_factory=dict)


def configured() -> bool:
    s = get_settings()
    return bool(s.cam_verify_url.strip() and s.cam_verify_api_key.strip())


def _clean_person(raw: object) -> dict[str, str]:
    data = raw if isinstance(raw, dict) else {}
    return {k: " ".join(str(data.get(k) or "").split()) for k in PERSON_FIELDS}


def verify_staff(pinfl: str, frames: list[bytes] | None = None) -> CamResult:
    s = get_settings()
    if not configured():
        raise CamUnavailable("cam_verify sozlanmagan")
    files = [("frames", (f"frame{i}.jpg", data, "image/jpeg")) for i, data in enumerate(frames or [])]
    try:
        res = requests.post(
            s.cam_verify_url.rstrip("/") + ENDPOINT,
            headers={"X-Api-Key": s.cam_verify_api_key},
            data={"pinfl": pinfl, "request_id": str(uuid.uuid4())},
            files=files or None,
            timeout=s.cam_verify_timeout,
        )
    except requests.RequestException as exc:
        raise CamUnavailable(str(exc)) from exc
    if res.status_code == 429:
        raise CamRateLimited()
    if res.status_code != 200:
        raise CamUnavailable(f"HTTP {res.status_code}")
    try:
        body = res.json()
    except ValueError as exc:
        raise CamUnavailable("JSON emas") from exc
    if not isinstance(body, dict):
        raise CamUnavailable("JSON obyekt emas")

    person = _clean_person(body.get("person"))
    # "verified" faqat aniq `true` bo'lsa — va qaytgan JSHSHIR so'ralganiga mos bo'lsa.
    # Aks holda boshqa odamning ma'lumoti bilan hisob ochilib ketishi mumkin edi.
    if body.get("verified") is True and person["pinfl"] == pinfl:
        return CamResult(True, "", person)
    reason = str(body.get("reason") or "").strip()[:32] or ("pinfl_mismatch" if body.get("verified") is True else "")
    return CamResult(False, reason or "not_verified", {})
