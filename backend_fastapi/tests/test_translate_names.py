"""Fan va kafedra nomlarini tarjima qilish endpointi (AI va DB soxta)."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.api.routes import syllabus_catalog as sc


def rows(items):
    result = MagicMock()
    result.scalars.return_value.all.return_value = items
    return result


def test_translates_missing_names_once_and_keeps_existing():
    syl_uz = SimpleNamespace(id=1, subject_name="Ichki kasalliklar", name_i18n={}, instruction_language="uz",
                             allowed_owner_keys=[])
    syl_done = SimpleNamespace(id=2, subject_name="Anatomiya", name_i18n={"ru": "Анатомия"},
                               instruction_language="uz", allowed_owner_keys=[])
    dept = SimpleNamespace(name="Terapiya kafedrasi", name_i18n={})
    db = MagicMock()
    db.execute.side_effect = [rows([syl_uz, syl_done]), rows([dept])]
    auth = SimpleNamespace(user=SimpleNamespace(username="t1"), role="hodim")
    fake = {"Ichki kasalliklar": "Внутренние болезни", "Terapiya kafedrasi": "Кафедра терапии"}
    settings = SimpleNamespace(openai_api_key="k", openai_fast_model="m")
    with patch("app.services.syllabus_i18n._translate_batch", return_value=fake) as tr, patch(
        "app.core.config.get_settings", return_value=settings
    ), patch.object(sc, "_visible_to", return_value=True):
        out = sc.translate_syllabus_and_department_names(
            {"lang": "ru", "syllabus_ids": [1, 2], "departments": True}, db=db, auth=auth
        )
    # Faqat yetishmayotgan nomlar AI'ga yuboriladi.
    assert sorted(tr.call_args.args[2]) == ["Ichki kasalliklar", "Terapiya kafedrasi"]
    assert out["syllabi"] == {"1": "Внутренние болезни", "2": "Анатомия"}
    assert out["departments"] == {"Terapiya kafedrasi": "Кафедра терапии"}
    assert syl_uz.name_i18n["ru"] == "Внутренние болезни"
    db.commit.assert_called_once()


def test_wrong_language_answer_is_not_stored():
    syl = SimpleNamespace(id=1, subject_name="Ichki kasalliklar", name_i18n={}, instruction_language="uz",
                          allowed_owner_keys=[])
    db = MagicMock()
    db.execute.side_effect = [rows([syl])]
    auth = SimpleNamespace(user=SimpleNamespace(username="t1"), role="hodim")
    settings = SimpleNamespace(openai_api_key="k", openai_fast_model="m")
    with patch("app.services.syllabus_i18n._translate_batch", return_value={"Ichki kasalliklar": "Internal diseases"}), \
         patch("app.core.config.get_settings", return_value=settings), patch.object(sc, "_visible_to", return_value=True):
        out = sc.translate_syllabus_and_department_names({"lang": "ru", "syllabus_ids": [1]}, db=db, auth=auth)
    assert out["syllabi"] == {}
    assert syl.name_i18n == {}
