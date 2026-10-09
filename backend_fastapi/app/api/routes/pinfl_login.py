"""JSHSHIR bilan kirish: cam.fermi.uz `verified=true` qaytarsa — xodim tizimga kiradi.

Parol so'ralmaydi (institut qarori, 2026-10-08). Shuning uchun:
  * faqat `hodim` hisobi — admin/klinika admini bu yo'ldan kira olmaydi;
  * JSHSHIR va IP bo'yicha cheklov;
  * har kirish faollik jurnaliga `method="pinfl_cam"` bilan yoziladi.
Boshqa kirish yo'llari (login+parol, JSHSHIR+parol, yuz) o'zgarmaydi.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.routes.auth import _login_response
from app.core.db import get_db
from app.core.throttling import enforce, throttle_login_account
from app.schemas.auth import LoginResponse
from app.services import auth_service, cam_login, cam_verify, staff_pinfl
from app.services.analytics_service import record_activity_event

logger = logging.getLogger("imentor.pinfl_login")
router = APIRouter()

# Bitta JSHSHIR bilan soatiga 10 urinish — begona JSHSHIRlarni ketma-ket sinashni sekinlatadi.
PINFL_RATE = "10/hour"

REASON_TEXT = {
    "not_found": "Bu JSHSHIR cam.fermi.uz xodimlari ro'yxatida topilmadi.",
    "ambiguous": "Bu JSHSHIR cam.fermi.uz'da bir necha yozuvda turibdi. Administratorga murojaat qiling.",
    "inactive": "cam.fermi.uz'da bu xodim faol emas.",
}


class PinflLoginRequest(BaseModel):
    pinfl: str


@router.post("/auth/pinfl-login/", response_model=LoginResponse)
def pinfl_login(
    payload: PinflLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> LoginResponse:
    pinfl = "".join(payload.pinfl.split())
    if not staff_pinfl.is_pinfl(pinfl):
        raise HTTPException(status_code=422, detail="JSHSHIR 14 ta raqamdan iborat bo'lishi kerak.")
    throttle_login_account(request, pinfl)
    enforce(f"throttle:pinfl_login:{pinfl}", PINFL_RATE)

    try:
        result = cam_verify.verify_staff(pinfl)
    except cam_verify.CamRateLimited:
        raise HTTPException(status_code=429, detail="Urinishlar ko'p. Birozdan keyin qayta urining.")
    except cam_verify.CamUnavailable as exc:
        logger.warning("cam.fermi.uz tasdig'i olinmadi: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="JSHSHIR orqali kirish hozir ishlamayapti. Login va parol bilan kiring.",
        )
    if not result.verified:
        logger.info("JSHSHIR kirish rad etildi: ...%s reason=%s", pinfl[-4:], result.reason)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=REASON_TEXT.get(result.reason, "JSHSHIR tasdiqlanmadi. Login va parol bilan kiring."),
        )

    try:
        user, role, created = cam_login.account_for(db, pinfl, result.person)
    except cam_login.CamLoginRefused:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bu hisobga JSHSHIR orqali kirib bo'lmaydi. Login va parol bilan kiring.",
        )
    auth_service.touch_last_login(db, user)
    record_activity_event(
        db, owner_key=user.username, role=role, event_type="login",
        meta={"method": "pinfl_cam", "pinfl_tail": pinfl[-4:], "account_created": created},
    )
    db.commit()
    if created:
        logger.info("JSHSHIR orqali yangi hisob ochildi: %s (...%s)", user.username, pinfl[-4:])
    return _login_response(db, user, role)
