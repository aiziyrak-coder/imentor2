"""Batafsil ko'rinish tanlangan DAVRGA bog'liq bo'lishi kerak (2026-09-29).

Ilgari "Oxirgi kirish" har doim `User.last_login` edi: rektor kechagi kunni
ochsa ham bugungi sana chiqib, hisobotning qolgan raqamlari bilan ziddiyat
hosil qilardi. Endi davr ichidagi oxirgi faol kun alohida beriladi.
"""

import datetime as dt
from unittest.mock import MagicMock, patch

from app.services import control_report_service as cr

YESTERDAY = dt.date(2026, 9, 28)
TODAY = dt.date(2026, 9, 29)


def _detail(days, *, start=YESTERDAY, end=YESTERDAY):
    def day(date, minutes=0, tests=0, cases=0, live=0):
        return {"date": date.isoformat(), "minutes": minutes, "pages": [],
                "videos_viewed": 0, "handouts_viewed": 0,
                "cases_created": cases, "tests_created": tests, "live_sessions": live}

    with patch("app.services.lesson_report_service._lessons", return_value=[]), \
         patch("app.services.lesson_report_service._used_map", return_value={}), \
         patch("app.services.lesson_report_service.lesson_rows", return_value=[]), \
         patch("app.services.rector_report_service.staff_directory",
               return_value={"u1": {"display_name": "AZIZOV A.", "job_title": "", "department": "",
                                    # Bugun kirgan, lekin hisobot KECHA uchun.
                                    "last_login": dt.datetime(2026, 9, 29, 9, 0)}}), \
         patch("app.services.rector_report_service.created_materials", return_value={}), \
         patch("app.services.rector_report_service.teaching_counts", return_value={}), \
         patch.object(cr.ta, "engagement_map", return_value={}), \
         patch.object(cr.ta, "profile_map", return_value={}), \
         patch.object(cr.ta, "materials_map", return_value={}), \
         patch("app.services.activity_report_service.teacher_daily_activity",
               return_value={"days": [day(*d) for d in days]}):
        return cr.teacher_detail(MagicMock(), "u1", start, end)


def test_last_active_comes_from_the_selected_period_not_from_today():
    out = _detail([(YESTERDAY, 12)])
    assert out["profile"]["last_active"] == YESTERDAY.isoformat()
    # Umumiy oxirgi kirish yo'qolmaydi — u alohida maydon.
    assert out["profile"]["last_login"].startswith(TODAY.isoformat())


def test_no_activity_in_the_period_means_empty_not_todays_login():
    out = _detail([])
    assert out["profile"]["last_active"] is None


def test_a_day_without_minutes_but_with_created_material_still_counts():
    """Test yaratgan, lekin daqiqa qayd etilmagan kun ham faollik."""
    out = _detail([(YESTERDAY, 0, 3)])
    assert out["profile"]["last_active"] == YESTERDAY.isoformat()


def test_the_latest_active_day_of_the_range_wins():
    out = _detail([(dt.date(2026, 9, 26), 5), (YESTERDAY, 7)], start=dt.date(2026, 9, 23), end=YESTERDAY)
    assert out["profile"]["last_active"] == YESTERDAY.isoformat()
