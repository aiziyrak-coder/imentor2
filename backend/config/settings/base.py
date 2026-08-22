from __future__ import annotations

import os
from pathlib import Path

from .env import env_bool, env_list, load_dotenv

BASE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BASE_DIR / ".env")

SECRET_KEY = os.getenv(
    "DJANGO_SECRET_KEY",
    "CHANGE_ME_IN_PRODUCTION_very_long_random_secret_key_please_replace",
)

DEBUG = env_bool("DJANGO_DEBUG", default=True)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", default="127.0.0.1,localhost")

# Reverse proxy (nginx / Cloudflare): trust X-Forwarded-* for HTTPS and Host.
_BEHIND_PROXY = env_bool("DJANGO_BEHIND_PROXY", default=False)
USE_X_FORWARDED_HOST = _BEHIND_PROXY
USE_X_FORWARDED_PORT = _BEHIND_PROXY
SECURE_PROXY_SSL_HEADER = (
    ("HTTP_X_FORWARDED_PROTO", "https") if _BEHIND_PROXY else None
)

INSTALLED_APPS = [
    "jazzmin",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "drf_spectacular",
    "core.apps.CoreConfig",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

_db_engine = os.getenv("DJANGO_DB_ENGINE", "postgresql").strip().lower()

if _db_engine in ("postgresql", "postgres"):
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.getenv("DJANGO_DB_NAME", "imentor"),
            "USER": os.getenv("DJANGO_DB_USER", "imentor"),
            "PASSWORD": os.getenv("DJANGO_DB_PASSWORD", ""),
            "HOST": os.getenv("DJANGO_DB_HOST", "127.0.0.1"),
            "PORT": os.getenv("DJANGO_DB_PORT", "5432"),
            "CONN_MAX_AGE": int(os.getenv("DJANGO_DB_CONN_MAX_AGE", "60")),
            "OPTIONS": {
                "connect_timeout": int(os.getenv("DJANGO_DB_CONNECT_TIMEOUT", "10")),
            },
        }
    }
else:
    raise RuntimeError(
        "SQLite olib tashlangan. DJANGO_DB_ENGINE=postgresql va "
        "DJANGO_DB_HOST/DJANGO_DB_PASSWORD ni sozlang (yoki docker compose ishlating)."
    )

# Shared cache — throttle va rate-limit (production/docker: Redis).
_redis_url = os.getenv("REDIS_URL", "").strip()
if _redis_url:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": _redis_url,
        }
    }
elif DEBUG:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "imentor-dev",
        }
    }
else:
    raise RuntimeError(
        "REDIS_URL talab qilinadi (masalan: redis://redis:6379/0). "
        "Docker compose bilan avtomatik beriladi."
    )

DATA_UPLOAD_MAX_MEMORY_SIZE = int(os.getenv("DJANGO_DATA_UPLOAD_MAX_MB", "25")) * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = DATA_UPLOAD_MAX_MEMORY_SIZE

# Productionda ochiq ro'yxatdan o'tishni o'chirish (faqat admin provision).
ALLOW_OPEN_REGISTRATION = env_bool("DJANGO_ALLOW_OPEN_REGISTRATION", default=DEBUG)

from datetime import timedelta  # noqa: E402

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(
        minutes=int(os.getenv("DJANGO_JWT_ACCESS_MINUTES", "30" if not DEBUG else "120"))
    ),
    "REFRESH_TOKEN_LIFETIME": timedelta(
        days=int(os.getenv("DJANGO_JWT_REFRESH_DAYS", "7"))
    ),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "uz"
TIME_ZONE = "Asia/Tashkent"
USE_I18N = True
USE_L10N = True
USE_TZ = True

LOCALE_PATHS = [BASE_DIR / "locale"]

DATE_FORMAT = "d.m.Y"
DATETIME_FORMAT = "d.m.Y H:i"
SHORT_DATE_FORMAT = "d.m.Y"
SHORT_DATETIME_FORMAT = "d.m.Y H:i"

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

MEDIA_URL = os.getenv("DJANGO_MEDIA_URL", "/media/").strip() or "/media/"
if not MEDIA_URL.endswith("/"):
    MEDIA_URL += "/"
_media_root = os.getenv("DJANGO_MEDIA_ROOT", "").strip()
MEDIA_ROOT = Path(_media_root) if _media_root else (BASE_DIR / "media")

HANDOUT_MAX_BYTES = int(os.getenv("DJANGO_HANDOUT_MAX_BYTES", str(20 * 1024 * 1024)))
PRESENTATION_MAX_BYTES = int(os.getenv("DJANGO_PRESENTATION_MAX_BYTES", str(50 * 1024 * 1024)))

# Yuklangan fayllar (tarqatma, syllabus PDF) — productionda ham /media/ orqali.
DJANGO_SERVE_MEDIA = env_bool("DJANGO_SERVE_MEDIA", default=DEBUG)

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.AllowAny",
    ),
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer"
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_THROTTLE_RATES": {
        "education_ai": os.getenv("DJANGO_AI_EDUCATION_RATE", "60/hour"),
        "startup_ai": os.getenv("DJANGO_AI_STARTUP_RATE", "40/hour"),
        "login": os.getenv("DJANGO_LOGIN_RATE", "20/minute"),
        "live_test_anon": os.getenv("DJANGO_LIVE_TEST_ANON_RATE", "120/minute"),
        "staff_ping": os.getenv("DJANGO_STAFF_PING_RATE", "2/minute"),
    },
}

SPECTACULAR_SETTINGS = {
    "TITLE": "iMentor API",
    "DESCRIPTION": "API documentation for iMentor backend",
    "VERSION": "1.0.0",
}

CORS_ALLOW_ALL_ORIGINS = env_bool("DJANGO_CORS_ALLOW_ALL_ORIGINS", default=DEBUG)
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOWED_ORIGINS = env_list(
    "DJANGO_CORS_ALLOWED_ORIGINS",
    default="http://localhost:3000,http://127.0.0.1:3000",
)
CSRF_TRUSTED_ORIGINS = env_list(
    "DJANGO_CSRF_TRUSTED_ORIGINS",
    default="http://localhost:3000,http://127.0.0.1:3000",
)

SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", default=not DEBUG)
# Docker / ichki healthcheck HTTP bilan ishlashi uchun
SECURE_REDIRECT_EXEMPT = [r"^/api/health/?$"]
SESSION_COOKIE_SECURE = env_bool("DJANGO_SESSION_COOKIE_SECURE", default=not DEBUG)
CSRF_COOKIE_SECURE = env_bool("DJANGO_CSRF_COOKIE_SECURE", default=not DEBUG)
SECURE_HSTS_SECONDS = int(os.getenv("DJANGO_SECURE_HSTS_SECONDS", "0" if DEBUG else "31536000"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool(
    "DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS",
    default=not DEBUG,
)
SECURE_HSTS_PRELOAD = env_bool("DJANGO_SECURE_HSTS_PRELOAD", default=not DEBUG)
ALLOW_LEGACY_PREPARED_CONTENT_API = env_bool("DJANGO_ALLOW_LEGACY_PREPARED_CONTENT_API", default=DEBUG)

# Tashqi servislar uchun API kalitlari (vergul bilan). Masalan: key1,key2
EXTERNAL_API_KEYS = (os.getenv("IMENTOR_EXTERNAL_API_KEYS") or os.getenv("EXTERNAL_API_KEYS") or "").strip()

# OnlineTest — talaba auth (bitta login manbai). Asosiy: appi; zaxira: eski domen.
ONLINE_TEST_API_BASE_URL = (os.getenv("ONLINE_TEST_API_BASE_URL") or "").strip().rstrip("/")
ONLINE_TEST_API_FALLBACK_URL = (
    os.getenv("ONLINE_TEST_API_FALLBACK_URL") or "https://online-imtixon.uz"
).strip().rstrip("/")

# OnlineTest — Kafedra/Yo'nalish/Guruh katalogini o'qish uchun X-Api-Key
# (OnlineTest tomonidagi ONLINE_TEST_PUBLIC_API_KEYS ro'yxatiga mos bo'lishi kerak)
ONLINE_TEST_CONSUMER_API_KEY = (os.getenv("ONLINE_TEST_CONSUMER_API_KEY") or "").strip()

# OpenAI — test, keys, ma'ruza, tarjima va boshqalar. Kalit gitga kirmaydi.
OPENAI_API_KEY = (os.getenv("OPENAI_API_KEY") or os.getenv("DEEPSEEK_API_KEY") or "").strip()
OPENAI_CHAT_MODEL = os.getenv("OPENAI_CHAT_MODEL", "gpt-4o").strip() or "gpt-4o"
OPENAI_FAST_MODEL = os.getenv("OPENAI_FAST_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
OPENAI_REASONER_MODEL = os.getenv("OPENAI_REASONER_MODEL", "gpt-4o").strip() or "gpt-4o"
# Eski nom (moslik)
DEEPSEEK_API_KEY = OPENAI_API_KEY

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Celery — AI tasklar Redis orqali
CELERY_BROKER_URL = _redis_url or "redis://127.0.0.1:6379/0"
CELERY_RESULT_BACKEND = CELERY_BROKER_URL
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TASK_DEFAULT_QUEUE = "default"
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_TASK_ACKS_LATE = True
CELERY_TASK_TIME_LIMIT = int(os.getenv("CELERY_TASK_TIME_LIMIT", "300"))
CELERY_TASK_SOFT_TIME_LIMIT = int(os.getenv("CELERY_TASK_SOFT_TIME_LIMIT", "270"))

JAZZMIN_SETTINGS = {
    "site_title": "Salomatlik AI",
    "site_header": "Salomatlik AI boshqaruvi",
    "site_brand": "Salomatlik AI",
    "site_logo_classes": "img-circle",
    "welcome_sign": "Boshqaruv paneliga xush kelibsiz",
    "copyright": "Salomatlik AI",
    "search_model": ["auth.User", "auth.Group"],
    "topmenu_links": [
        {"name": "Asosiy sayt", "url": "https://imentor.uz", "new_window": True},
        {"name": "API hujjatlari", "url": "/api/docs/", "new_window": True},
        {"name": "Admin bosh sahifa", "url": "admin:index", "permissions": ["auth.view_user"]},
    ],
    "usermenu_links": [
        {"name": "Asosiy sayt", "url": "https://imentor.uz", "new_window": True},
    ],
    "show_sidebar": True,
    "navigation_expanded": True,
    "hide_apps": [],
    "hide_models": [],
    "order_with_respect_to": ["auth", "core"],
    "icons": {
        "auth": "fas fa-users-cog",
        "auth.user": "fas fa-user",
        "auth.group": "fas fa-users",
        "core.PreparedContent": "fas fa-book",
        "core.SyllabusDocument": "fas fa-file-pdf",
        "core.CourseSyllabus": "fas fa-graduation-cap",
        "core.StaffCourseSelection": "fas fa-check-circle",
        "core.LiveTestSession": "fas fa-clipboard-check",
        "core.LiveTestSubmission": "fas fa-pen",
        "core.StartupProjectApplication": "fas fa-rocket",
        "core.CampusBuilding": "fas fa-building",
        "core.StaffScheduleSlot": "fas fa-calendar-alt",
        "core.StaffLocationPing": "fas fa-map-marker-alt",
        "core.StaffLocationAlert": "fas fa-bell",
        "core.TopicHandout": "fas fa-file-alt",
        "core.TopicPresentation": "fas fa-chalkboard",
        "core.DevicePairingSession": "fas fa-qrcode",
        "core.StaffProfile": "fas fa-id-card",
    },
    "default_icon_parents": "fas fa-folder",
    "default_icon_children": "fas fa-circle",
    "related_modal_active": True,
    "use_google_fonts_cdn": True,
    "show_ui_builder": False,
    "changeform_format": "horizontal_tabs",
    "changeform_format_overrides": {
        "auth.user": "collapsible",
        "auth.group": "vertical_tabs",
    },
    "language_chooser": False,
    "custom_css": None,
    "custom_js": None,
}

JAZZMIN_UI_TWEAKS = {
    "theme": "flatly",
    "dark_mode_theme": "darkly",
    "navbar": "navbar-white navbar-light",
    "navbar_fixed": True,
    "footer_fixed": False,
    "sidebar_fixed": True,
    "sidebar": "sidebar-dark-primary",
    "sidebar_nav_small_text": False,
    "sidebar_disable_expand": False,
    "sidebar_nav_child_indent": True,
    "sidebar_nav_compact_style": False,
    "sidebar_nav_legacy_style": False,
    "sidebar_nav_flat_style": False,
    "accent": "accent-primary",
    "brand_colour": "navbar-primary",
    "button_classes": {
        "primary": "btn-primary",
        "secondary": "btn-secondary",
        "info": "btn-info",
        "warning": "btn-warning",
        "danger": "btn-danger",
        "success": "btn-success",
    },
}
