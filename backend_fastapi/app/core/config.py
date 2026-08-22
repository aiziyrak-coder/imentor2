from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Env o'zgaruvchilari — mavjud Django backend (config/settings/base.py) bilan
    bir xil nomlarda, shunda docker-compose env bloki o'zgarishsiz qoladi."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    django_env: str = "dev"
    django_debug: bool = True
    django_secret_key: str = "CHANGE_ME_IN_PRODUCTION_very_long_random_secret_key_please_replace"

    django_db_engine: str = "postgresql"
    django_db_name: str = "imentor"
    django_db_user: str = "imentor"
    django_db_password: str = ""
    django_db_host: str = "127.0.0.1"
    django_db_port: str = "5432"

    redis_url: str = "redis://127.0.0.1:6379/0"

    # Sessiya 12 soat davom etadi — o'qituvchi ish kuni davomida qayta
    # kirmasligi kerak. Refresh token undan uzunroq (o'chib qolgan tabni
    # ochganda ham sessiya tiklanadi).
    django_jwt_access_minutes: int = 720
    django_jwt_refresh_days: int = 14

    openai_api_key: str = ""
    openai_chat_model: str = "gpt-4o"
    openai_fast_model: str = "gpt-4o-mini"
    openai_reasoner_model: str = "gpt-4o"

    online_test_api_base_url: str = ""
    online_test_api_fallback_url: str = "https://online-imtixon.uz"
    online_test_consumer_api_key: str = ""

    django_media_root: str = ""
    django_media_url: str = "/media/"

    django_cors_allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # Prod xavfsiz default: ochiq ro'yxatdan o'tish va legacy API o'chirilgan.
    # Dev compose bu qiymatlarni aniq `True` qilib beradi.
    django_allow_open_registration: bool = False
    django_allow_legacy_prepared_content_api: bool = False

    django_ai_education_rate: str = "60/hour"
    django_ai_startup_rate: str = "40/hour"
    django_login_rate: str = "20/minute"
    django_live_test_anon_rate: str = "120/minute"
    django_staff_ping_rate: str = "2/minute"

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg://{self.django_db_user}:{self.django_db_password}"
            f"@{self.django_db_host}:{self.django_db_port}/{self.django_db_name}"
        )

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.django_cors_allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
