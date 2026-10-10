import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services import case_i18n as i18n

UZ_CASE = {
    "scenario": "### Bemor\n45 yoshli ayol bosh og'rig'i bilan murojaat qildi. Qon bosimi 160/100, u ilgari davolanmagan va bu holat hisoblanadi.",
    "answer": "Arterial gipertenziya uchun davolash rejasi tuziladi va bemor kuzatiladi.",
    "focus": "tashxis",
}
RU_CASE = {
    "scenario": "### Больной\nЖенщина 45 лет обратилась с жалобами на головную боль. Давление 160/100, ранее не лечилась.",
    "answer": "Составляется план лечения артериальной гипертензии и наблюдение за пациенткой.",
    "focus": "диагноз",
}
EN_CASE = {
    "scenario": "### Patient\nA 45-year-old woman presents with a headache. Her blood pressure is 160/100 and she was never treated.",
    "answer": "A treatment plan for arterial hypertension is made and the patient is followed up.",
    "focus": "diagnosis",
}
UZ_CYR_CASE = {
    "scenario": "### Бемор\n45 ёшли аёл бош оғриғи билан мурожаат қилди. Қон босими 160/100, у илгари даволанмаган.",
    "answer": "Артериал гипертензия учун даволаш режаси тузилади ва бемор кузатилади.",
    "focus": "ташхис",
}


def test_detect_language():
    assert i18n.detect_language(UZ_CASE["scenario"]) == "uz"
    assert i18n.detect_language(RU_CASE["scenario"]) == "ru"
    assert i18n.detect_language(EN_CASE["scenario"]) == "en"
    assert i18n.detect_language(UZ_CYR_CASE["scenario"]) == "uz-cyr"
    assert i18n.detect_language("ok") == "?"


def test_primary_language_comes_from_text_not_the_uz_default():
    # Ilgari keysda primaryLanguage yo'q edi va ruscha keys "uz" deb olinardi.
    assert i18n.primary_language({"questions": [RU_CASE]}) == "ru"
    assert i18n.primary_language({"questions": [EN_CASE], "primaryLanguage": "uz"}) == "en"


def test_copy_or_transliteration_is_not_a_translation():
    kind = i18n.KIND_CASE
    assert not i18n._translation_ok(UZ_CASE, dict(UZ_CASE), "ru", kind)  # nusxa
    assert not i18n._translation_ok(UZ_CASE, UZ_CYR_CASE, "ru", kind)  # kirilldagi o'zbekcha
    assert i18n._translation_ok(UZ_CASE, RU_CASE, "ru", kind)
    assert i18n._translation_ok(UZ_CASE, EN_CASE, "en", kind)


def test_long_text_is_split_so_the_client_does_not_truncate_it():
    long = "\n\n".join(["Bemor holati batafsil tavsiflanadi va davolash rejasi muhokama qilinadi. " * 20] * 6)
    assert len(long) > i18n.CHUNK_CHARS
    sent: list[list[str]] = []

    def fake_call(api_key, model, items, kind, source, target, note):
        sent.append(items)
        return [f"T:{len(x)}" for x in items]

    with patch.object(i18n, "_call", side_effect=fake_call):
        out = i18n._translate_strings("k", "m", ["qisqa", long], "ru", source="uz")
    assert all(sum(len(x) for x in batch) <= i18n.CHUNK_CHARS or len(batch) == 1 for batch in sent)
    assert len(out) == 2 and out[0] == "T:5" and out[1].count("T:") > 1


def _item(kind, payload):
    return SimpleNamespace(id=1, kind=kind, payload=payload)


def test_ensure_translations_fixes_russian_case_and_rejects_bad_output():
    item = _item(i18n.KIND_CASE, {"questions": [RU_CASE], "primaryLanguage": "uz", "translations": {"ru": {"questions": [RU_CASE]}}})
    replies = {
        "uz": [json.dumps({"items": i18n._extract_strings([UZ_CYR_CASE])}), json.dumps({"items": i18n._extract_strings([UZ_CASE])})],
        "en": [json.dumps({"items": i18n._extract_strings([EN_CASE])})],
    }
    calls = []

    def fake_chat(api_key, *, messages, **kw):
        target = "uz" if "Uzbek (Latin" in messages[0]["content"].split("into ")[1][:40] else "en"
        calls.append((target, "REJECTED" in messages[0]["content"]))
        return replies[target].pop(0)

    settings = SimpleNamespace(openai_api_key="k", openai_fast_model="m")
    with patch.object(i18n, "get_settings", return_value=settings), patch.object(i18n.oai, "generate_openai_chat", side_effect=fake_chat):
        assert i18n.ensure_translations(MagicMock(), item) is True
    p = item.payload
    assert p["primaryLanguage"] == "ru"
    assert "ru" not in p["translations"]  # o'z nusxasi olib tashlandi
    assert p["translations"]["uz"]["questions"][0]["focus"] == "tashxis"
    assert p["translations"]["en"]["questions"][0]["focus"] == "diagnosis"
    # Kirilldagi o'zbekcha rad etildi va qat'iy ogohlantirish bilan qayta so'raldi.
    assert ("uz", False) in calls and ("uz", True) in calls


def test_edit_drops_translations_that_were_not_updated():
    old = {"questions": [UZ_CASE], "translations": {"ru": {"questions": [RU_CASE]}}}
    edited = {**UZ_CASE, "answer": "Yangi javob matni, davolash rejasi o'zgartirildi."}
    new = {"questions": [edited], "translations": {"ru": {"questions": [RU_CASE]}}}
    out = i18n.invalidate_stale_translations(i18n.KIND_CASE, old, new)
    assert out is not None and out["translations"] == {}
    assert i18n.invalidate_stale_translations(i18n.KIND_CASE, old, old) is None


def test_list_fields_are_sent_as_separate_items_and_rebuilt_by_length():
    q = {"question": "Qaysi variant to'g'ri?", "options": ["bir", "ikki", "uch"], "explanation": "izoh", "optionExplanations": ["a", "b", "c"], "correctOptionIndex": 1}
    strings = i18n._extract_strings([q], i18n.KIND_TEST)
    assert strings == ["Qaysi variant to'g'ri?", "izoh", "bir", "ikki", "uch", "a", "b", "c"]
    rebuilt = i18n._apply_strings([q], [s.upper() for s in strings], i18n.KIND_TEST)[0]
    assert rebuilt["options"] == ["BIR", "IKKI", "UCH"] and rebuilt["optionExplanations"] == ["A", "B", "C"]
    assert rebuilt["correctOptionIndex"] == 1


def test_case_headings_are_never_given_to_the_model():
    sent = []

    def fake_call(api_key, model, items, kind, source, target, note):
        sent.extend(items)
        return [x.replace("Olimjon universitetda dars beradi.", "Olimjon teaches at a university.") for x in items]

    text = "### Kim ishtirok etadi\nOlimjon universitetda dars beradi.\n\nAsosiy xulosa\nOlimjon universitetda dars beradi."
    with patch.object(i18n, "_call", side_effect=fake_call):
        out = i18n._translate_strings("k", "m", [text], "en", source="uz")
    assert "Kim ishtirok" not in sent[0] and "§H" in sent[0]
    assert out[0].startswith("### Who is involved\nOlimjon teaches")
    assert "Main conclusion\n" in out[0]


def test_failed_batch_falls_back_to_one_item_at_a_time():
    calls = []

    def fake_call(api_key, model, items, kind, source, target, note):
        calls.append(len(items))
        return None if len(items) > 1 else [items[0].upper()]

    with patch.object(i18n, "_call", side_effect=fake_call):
        out = i18n._translate_strings("k", "m", ["birinchi matn", "ikkinchi matn"], "en", source="uz")
    assert out == ["BIRINCHI MATN", "IKKINCHI MATN"] and calls == [2, 1, 1]


def test_wrong_case_heading_makes_translation_invalid():
    src = {"scenario": "### Kim ishtirok etadi\nOlimjon universitetda falsafa fanidan dars beradi va talabalar bilan ishlaydi.", "answer": "", "focus": ""}
    good = {"scenario": "### Who is involved\nOlimjon teaches philosophy at the university and works with the students.", "answer": "", "focus": ""}
    bad = {"scenario": "### Participation of Kim\nOlimjon teaches philosophy at the university and works with the students.", "answer": "", "focus": ""}
    assert i18n._translation_ok(src, good, "en", i18n.KIND_CASE)
    assert not i18n._translation_ok(src, bad, "en", i18n.KIND_CASE)
