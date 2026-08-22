from __future__ import annotations

import os
from contextlib import asynccontextmanager

from anyio import to_thread
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.admin import register_admin
from app.api.routes import (
    admin_reports,
    analytics,
    auth,
    clinic_admin,
    clinical_group,
    content_catalog,
    device_pairing,
    education_ai,
    external_api,
    health,
    legacy,
    live_test,
    prepared_content,
    staff_admin,
    staff_location,
    subject_book,
    syllabus_catalog,
    topic_content,
)
from app.core.compression import SmartGZipMiddleware
from app.core.config import get_settings
from app.services.file_storage import media_root

settings = get_settings()

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Sinxron (`def`) endpointlar uchun ishchi oqimlar (thread) chegarasi.

    FastAPI `def` bilan yozilgan endpointlarni threadpool'da bajaradi.
    AI generatsiyasi 1-5 daqiqa davom etadi va shu vaqt davomida bitta
    oqimni band qiladi — chegara juda past bo'lsa, AI so'rovlari login va
    sillabus kabi tez so'rovlarni ham bloklab qo'yadi.

    Anyio standarti 40; uni aniq belgilab qo'yamiz, shunda kutubxona
    versiyasi o'zgarganda sig'im jimgina o'zgarib ketmaydi.
    """
    limiter = to_thread.current_default_thread_limiter()
    limiter.total_tokens = int(os.environ.get("APP_THREAD_LIMIT", "48"))
    yield


app = FastAPI(title="iMentor API (FastAPI)", version="0.1.0", lifespan=lifespan)

# Sillabus katalogi ~1.5 MB JSON qaytaradi — gzip'siz har bir o'qituvchi
# kirganda shuncha trafik ketadi. SSE oqimi va siqilgan fayllar chetlab
# o'tiladi (app/core/compression.py).
app.add_middleware(SmartGZipMiddleware, minimum_size=1024, compresslevel=6)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SessionMiddleware, secret_key=settings.django_secret_key)

register_admin(app)

app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(auth.router, prefix="/api/v1", tags=["auth"])
app.include_router(syllabus_catalog.router, prefix="/api/v1", tags=["syllabus"])
app.include_router(live_test.router, prefix="/api/v1", tags=["live-test"])
app.include_router(staff_location.router, prefix="/api/v1", tags=["staff-location"])
app.include_router(clinical_group.router, prefix="/api/v1", tags=["clinical-group"])
app.include_router(clinic_admin.router, prefix="/api/v1", tags=["clinic-admin"])
app.include_router(subject_book.router, prefix="/api/v1", tags=["subject-book"])
app.include_router(device_pairing.router, prefix="/api/v1", tags=["device-pairing"])
app.include_router(staff_admin.router, prefix="/api/v1", tags=["staff-admin"])
app.include_router(content_catalog.router, prefix="/api/v1", tags=["content-catalog"])
app.include_router(topic_content.router, prefix="/api/v1", tags=["topic-content"])
app.include_router(education_ai.router, prefix="/api/v1", tags=["education-ai"])
app.include_router(external_api.router, prefix="/api/v1", tags=["external-api"])
app.include_router(prepared_content.router, prefix="/api/v1", tags=["prepared-content"])
app.include_router(analytics.router, prefix="/api/v1", tags=["analytics"])
app.include_router(admin_reports.router, prefix="/api/v1", tags=["admin-reports"])
app.include_router(legacy.router, prefix="/api/v1", tags=["legacy"])
app.include_router(legacy.root_router, prefix="/api", tags=["legacy"])

_media_mount_path = "/" + settings.django_media_url.strip("/")
os.makedirs(media_root(), exist_ok=True)
app.mount(_media_mount_path, StaticFiles(directory=media_root()), name="media")
