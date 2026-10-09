"""Ma'ruza va taqdimot tarjimasi (`content_i18n`) hamda PATCH paytida tarjimalarni saqlash.

AI chaqirilmaydi: `case_i18n._translate_strings` soxta "tarjimon" bilan almashtiriladi.
"""

from unittest.mock import patch

from app.services import content_i18n as ci18n
from app.services.prepared_translation import merge_on_update

UZ_LECTURE = (
    "# Arterial gipertenziya\n\n"
    "Bu mavzu bemorlarda qon bosimi oshishi va uning davolash usullari haqida. "
    "Kasallik keng tarqalgan va yurak uchun xavfli hisoblanadi.\n\n"
    "## Davolash\n\nDavolash rejasi bemor holatiga qarab tuziladi va kuzatiladi."
)
RU_TEXT = (
    "Эта тема посвящена повышению давления у пациентов и методам лечения. "
    "Заболевание широко распространено и опасно для сердца."
)


def fake_translator(target_text: str):
    def _fake(api_key, model, items, target, **kwargs):
        return [target_text if item.strip() else item for item in items]

    return _fake


def settings_with_key():
    return type("S", (), {"openai_api_key": "test", "openai_fast_model": "m"})()


def test_lecture_primary_language_detected_from_text():
    assert ci18n.primary_language("lecture", {"content": UZ_LECTURE}) == "uz"


def test_lecture_translation_is_stored_with_hash():
    payload = {"topic": "Gipertenziya", "content": UZ_LECTURE}
    with patch.object(ci18n, "get_settings", settings_with_key), patch.object(
        ci18n.ci, "_translate_strings", fake_translator(RU_TEXT)
    ):
        out = ci18n.translate_payload("lecture", payload, "ru")
    assert out is not None
    assert out["primaryLanguage"] == "uz"
    assert RU_TEXT in out["translations"]["ru"]["content"]
    assert out["i18nSourceHash"] == ci18n.source_hash("lecture", payload)
    assert ci18n.has_translation("lecture", out, "ru")


def test_wrong_language_translation_is_never_saved():
    """Model o'zbekcha matnni qaytarsa — yarim/noto'g'ri tarjima saqlanmaydi."""
    payload = {"topic": "Gipertenziya", "content": UZ_LECTURE}
    with patch.object(ci18n, "get_settings", settings_with_key), patch.object(
        ci18n.ci, "_translate_strings", fake_translator(UZ_LECTURE)
    ):
        assert ci18n.translate_payload("lecture", payload, "ru") is None


def test_primary_language_needs_no_ai():
    payload = {"topic": "Gipertenziya", "content": UZ_LECTURE}
    with patch.object(ci18n.ci, "_translate_strings") as tr:
        out = ci18n.translate_payload("lecture", payload, "uz")
    tr.assert_not_called()
    assert out["primaryLanguage"] == "uz"


def test_stale_translation_is_not_reported_as_ready():
    payload = {
        "content": UZ_LECTURE + "\n\nYangi paragraf qo'shildi va bemor kuzatildi.",
        "primaryLanguage": "uz",
        "translations": {"ru": {"content": RU_TEXT}},
        "i18nSourceHash": ci18n.source_hash("lecture", {"content": UZ_LECTURE}),
    }
    assert not ci18n.has_translation("lecture", payload, "ru")


def test_deck_texts_are_translated_but_images_and_references_kept():
    deck = {
        "presentation_title": "Arterial gipertenziya va uning davolash usullari haqida",
        "subject_area": "Ichki kasalliklar",
        "author": "Dr. Karimov",
        "references": [{"title": "Harrison's Principles"}],
        "slides": [
            {
                "slide_type": "content_bullets",
                "title": "Kirish",
                "image_query": "hypertension heart",
                "imageSourceUrl": "https://example.org/a.png",
                "body": {"bullets": ["Qon bosimi oshishi bemorlarda keng tarqalgan holat hisoblanadi."]},
            }
        ],
    }
    with patch.object(ci18n, "get_settings", settings_with_key), patch.object(
        ci18n.ci, "_translate_strings", fake_translator(RU_TEXT)
    ):
        out = ci18n.translate_payload("presentation", deck, "ru")
    ru = out["translations"]["ru"]
    assert ru["slides"][0]["body"]["bullets"] == [RU_TEXT]
    assert ru["slides"][0]["image_query"] == "hypertension heart"
    assert ru["slides"][0]["imageSourceUrl"] == "https://example.org/a.png"
    assert ru["references"] == deck["references"]
    assert ru["author"] == "Dr. Karimov"


def test_patch_keeps_background_translations_when_text_unchanged():
    """Mijoz eski nusxani yuborsa ham fonda qo'shilgan tarjima yo'qolmaydi."""
    old = {
        "content": UZ_LECTURE,
        "primaryLanguage": "uz",
        "translations": {"ru": {"content": RU_TEXT}},
        "i18nSourceHash": ci18n.source_hash("lecture", {"content": UZ_LECTURE}),
    }
    new = {"topic": "T", "content": UZ_LECTURE}
    merged = merge_on_update("lecture", old, new)
    assert merged["translations"]["ru"]["content"] == RU_TEXT
    assert ci18n.has_translation("lecture", merged, "ru")


def test_patch_drops_translations_when_text_changed():
    old = {
        "content": UZ_LECTURE,
        "translations": {"ru": {"content": RU_TEXT}},
        "i18nSourceHash": ci18n.source_hash("lecture", {"content": UZ_LECTURE}),
    }
    new = {"content": UZ_LECTURE + " Qo'shimcha.", "translations": {"ru": {"content": RU_TEXT}}}
    merged = merge_on_update("lecture", old, new)
    assert "translations" not in merged


def test_patch_teacher_edited_translation_wins():
    old = {
        "content": UZ_LECTURE,
        "translations": {"ru": {"content": RU_TEXT}},
        "i18nSourceHash": ci18n.source_hash("lecture", {"content": UZ_LECTURE}),
    }
    edited = RU_TEXT + " Исправлено преподавателем."
    new = {**old, "translations": {"ru": {"content": edited}}}
    assert merge_on_update("lecture", old, new)["translations"]["ru"]["content"] == edited
