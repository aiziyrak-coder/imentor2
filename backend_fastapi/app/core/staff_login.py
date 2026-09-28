"""Xodim login identifikatorini normallashtirish.

Xodim ikki xil identifikator bilan kirishi mumkin:

  * telefon raqami — 998 bilan boshlanuvchi 12 xonali (eski, qo'lda
    qo'shilgan hisoblar);
  * **Xodim ID** — kadrlar ro'yxatidagi tabel raqami (masalan `3442112068`),
    ommaviy import qilingan hisoblar shu bilan yaratiladi.

Ikkalasi ham `auth_user.username` ustunida saqlanadi, shuning uchun
tekshiruv bitta joyda bo'lishi kerak.
"""

from __future__ import annotations

# Xodim ID uzunligi chegarasi — tasodifiy/qisqa kiritishlarni rad etish uchun.
MIN_STAFF_ID_LEN = 4
MAX_STAFF_ID_LEN = 32


def is_phone_login(value: str) -> bool:
    digits = "".join(ch for ch in value if ch.isdigit())
    return len(digits) == 12 and digits.startswith("998")


def normalize_staff_login(value: str) -> str:
    """Telefon → faqat raqamlar; Xodim ID → tozalangan alfanumerik.

    Xato qiymatda `ValueError` ko'taradi (pydantic validatorlari uchun).
    """
    raw = (value or "").strip()
    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) == 12 and digits.startswith("998"):
        return digits

    staff_id = "".join(ch for ch in raw if ch.isalnum()).upper()
    if MIN_STAFF_ID_LEN <= len(staff_id) <= MAX_STAFF_ID_LEN:
        return staff_id

    raise ValueError("Login telefon raqami (998XXXXXXXXX) yoki Xodim ID bo'lishi kerak.")


# Kirill yozuvidagi, lotinchaga o'xshash harflar. Telefonda klaviatura
# kirillchada qolgan tinglovchi "АВ 1234567" deb yozadi — ko'zga bir xil,
# lekin boshqa belgi, va kirish "parol xato" bilan tugardi.
_CYRILLIC_LOOKALIKES = str.maketrans(
    {"А": "A", "В": "B", "С": "C", "Е": "E", "а": "A", "в": "B", "с": "C", "е": "E"}
)


def normalize_listener_login(value: str) -> str:
    """Malaka tinglovchisi logini — pasport seriyasi va raqami.

    Farmoyishda "AD 2383789" deb yozilgan; tinglovchi "ad2383789",
    "AD-2383789" yoki bo'sh joy bilan yozishi mumkin. Hammasi bitta
    shaklga keltiriladi: faqat lotin harfi va raqam, katta harf.
    """
    raw = (value or "").translate(_CYRILLIC_LOOKALIKES)
    return "".join(ch for ch in raw if ch.isascii() and ch.isalnum()).upper()
