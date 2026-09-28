"""Testlar orasida jarayon ichidagi keshlar tozalanadi — har test o'z ma'lumotini ko'rsin."""

import pytest


@pytest.fixture(autouse=True)
def _clear_process_caches():
    from app.services import teacher_activity_service

    teacher_activity_service.clear_cache()
    yield
    teacher_activity_service.clear_cache()
