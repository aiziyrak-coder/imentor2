"""Kafedra va fanni rektor hisobotidan chiqarish (2026-10-10)."""

import datetime as dt
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services import dean_access, lesson_report_service as lrs, report_exclusion as rx

DAY = dt.date(2026, 10, 6)


def lesson(pk, *, dep="Fiziologiya", subject="Fiziologiya"):
    return SimpleNamespace(
        id=pk, hemis_id=str(pk), lesson_date=DAY, para="1-para", start_time="08:30", end_time="09:50",
        teacher_username="u1", department_name=dep, subject_name=subject, group_name="DI-101",
        lesson_type="Ma'ruza", auditorium_name="204", monitor_id="",
    )


def test_department_is_matched_despite_hemis_spelling():
    ex = rx.Exclusions(departments=["Umumiy xirurgiya"])
    assert ex.department_excluded("Umumiy jarrohlik kafedrasi")
    assert not ex.department_excluded("Fiziologiya")


def test_subject_is_matched_by_name_or_code():
    ex = rx.Exclusions(subject_names={rx.norm_subject("Jismoniy tarbiya")}, subject_codes={"JT-1"})
    assert ex.subject_excluded("JISMONIY  TARBIYA")
    assert ex.subject_excluded("", "JT-1")
    assert not ex.subject_excluded("Anatomiya", "AN-1")


def test_excluded_lessons_never_reach_the_report():
    rows = [lesson(1), lesson(2, dep="Umumiy jarrohlik"), lesson(3, subject="Jismoniy tarbiya")]
    db = MagicMock()
    db.execute.return_value.scalars.return_value = rows
    ex = rx.Exclusions(departments=["Umumiy xirurgiya"], subject_names={rx.norm_subject("Jismoniy tarbiya")})
    with patch.object(rx, "load", return_value=ex):
        out = lrs._lessons(db, DAY - dt.timedelta(days=1), DAY - dt.timedelta(days=1), pending=True)
    assert [r.id for r in out] == [1]


def test_rector_scope_drops_excluded_departments_only():
    with patch("app.services.report_exclusion.load", return_value=rx.Exclusions(departments=["Fiziologiya"])), \
         patch.object(dean_access, "known_departments", return_value=["Fiziologiya", "Anatomiya"]), \
         patch.object(dean_access, "_all_department_spellings", return_value=["Pediatriya"]):
        scope = dean_access.allowed_departments({"departments": []}, db=object())
    assert isinstance(scope, dean_access.ExclusionScope)
    assert scope == ["Anatomiya", "Pediatriya"]


def test_no_exclusions_keeps_the_rector_unrestricted():
    with patch("app.services.report_exclusion.load", return_value=rx.Exclusions()):
        assert dean_access.allowed_departments({"departments": []}, db=object()) == []


def test_schedule_drops_lessons_of_excluded_subjects():
    """Faqat chiqarilgan fanni o'tadigan o'qituvchi monitor jadvalidan ham tushadi."""
    from app.services import monitor_schedule_service as ms

    rows = [SimpleNamespace(teacher_username="a", subject="Jismoniy tarbiya"),
            SimpleNamespace(teacher_username="b", subject="Anatomiya"),
            SimpleNamespace(teacher_username="c", subject="")]
    db = MagicMock()
    db.execute.return_value.scalars.return_value.all.return_value = rows
    ex = rx.Exclusions(subject_names={rx.norm_subject("Jismoniy tarbiya")})
    with patch.object(rx, "load", return_value=ex):
        assert [e.teacher_username for e in ms._load_schedule(db)] == ["b", "c"]
