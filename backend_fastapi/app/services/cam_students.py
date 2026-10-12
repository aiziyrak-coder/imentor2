"""cam.fermi.uz iMentor integratsiyasi: talabani JSHSHIR bo'yicha jonli qidirish.

API: `<CAM_STUDENT_API_URL>/students/lookup` (POST, JSON `{"pinfl": ...}`),
`/health` (GET). Ikkalasi ham `X-API-Key` talab qiladi.

Nega kerak: talaba JSHSHIR bilan kirganda iMentor uni `person_identity`
nusxasidan qidiradi. Nusxa vaqti-vaqti bilan yangilanadi, shuning uchun
undan keyin cam.fermi.uz'da ro'yxatdan o'tgan talaba topilmasdi. Nusxada
yo'q bo'lsa — shu yerda jonli so'raladi.

Bu modul faqat HTTP qismi: hisob tanlash `auth.id_login` da. Javobdagi
talabaning OnlineTest ID'si cam.fermi.uz'da `hemis_id` nomi bilan saqlanadi
(`auth._student_user` izohi: 7031 tasining hammasi kontingentga mos tushgan).
"""

from __future__ import annotations

from dataclasses import dataclass

import requests

from app.core.config import get_settings

#: Javobda talaba ID'si turishi mumkin bo'lgan maydonlar (birinchi to'lgani olinadi).
ID_FIELDS = ("hemis_id", "student_id", "student_id_number")


class CamStudentsUnavailable(Exception):
    """Sozlanmagan, javob bermadi yoki kutilmagan javob qaytardi."""


@dataclass
class CamStudent:
    pinfl: str
    student_id: str
    first_name: str = ""
    last_name: str = ""


def configured() -> bool:
    s = get_settings()
    return bool(s.cam_student_api_url.strip() and s.cam_student_api_key.strip())


def _url(path: str) -> str:
    return get_settings().cam_student_api_url.strip().rstrip("/") + path


def _headers() -> dict[str, str]:
    return {"X-API-Key": get_settings().cam_student_api_key.strip()}


def _text(value: object) -> str:
    return " ".join(str(value or "").split())


def lookup(pinfl: str) -> CamStudent | None:
    """Topilsa — talaba, topilmasa — None. Boshqa holatlarda `CamStudentsUnavailable`."""
    if not configured():
        raise CamStudentsUnavailable("sozlanmagan")
    try:
        res = requests.post(_url("/students/lookup"), headers=_headers(), json={"pinfl": pinfl},
                            timeout=get_settings().cam_student_timeout)
    except requests.RequestException as exc:
        raise CamStudentsUnavailable(str(exc)) from exc
    if res.status_code in (400, 404):
        return None
    if res.status_code != 200:
        raise CamStudentsUnavailable(f"HTTP {res.status_code}")
    try:
        body = res.json()
    except ValueError as exc:
        raise CamStudentsUnavailable("JSON emas") from exc
    data = body.get("student") if isinstance(body, dict) and isinstance(body.get("student"), dict) else body
    if not isinstance(data, dict):
        raise CamStudentsUnavailable("JSON obyekt emas")
    # Javobdagi JSHSHIR so'ralganiga mos bo'lishi shart (bo'lsa): aks holda
    # boshqa talabaning hisobiga kiritib yuborish xavfi bor.
    got = _text(data.get("pinfl"))
    if got and got != pinfl:
        raise CamStudentsUnavailable("JSHSHIR mos emas")
    student_id = next((_text(data.get(k)) for k in ID_FIELDS if _text(data.get(k))), "")
    return CamStudent(pinfl=pinfl, student_id=student_id,
                      first_name=_text(data.get("first_name")), last_name=_text(data.get("last_name")))


def health() -> dict:
    """Admin uchun: kalit va manzil to'g'rimi. Kalitning o'zi hech qachon qaytarilmaydi."""
    if not configured():
        return {"configured": False, "ok": False, "detail": "CAM_STUDENT_API_URL / CAM_STUDENT_API_KEY o'rnatilmagan."}
    try:
        res = requests.get(_url("/health"), headers=_headers(), timeout=get_settings().cam_student_timeout)
    except requests.RequestException as exc:
        return {"configured": True, "ok": False, "detail": f"Ulanib bo'lmadi: {type(exc).__name__}"}
    ok = res.status_code == 200
    detail = "ok" if ok else {401: "Kalit noto'g'ri (401).", 403: "IP ro'yxatda yo'q (403)."}.get(
        res.status_code, f"HTTP {res.status_code}")
    return {"configured": True, "ok": ok, "detail": detail}
