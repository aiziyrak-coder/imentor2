"""Protokollar kutubxonasi (2026-09-24): milliy klinik protokol / SanPin generatsiyada majburiy."""

from unittest.mock import MagicMock, patch

from app.api.routes import education_ai as ai
from app.services import protocol_library as pl


def test_split_chunks_keeps_paragraph_boundaries_and_drops_scraps():
    text = ("Botulizm. Tashxis mezonlari.\n\n" + "Bemorga antitoksin yuboriladi. " * 80
            + "\n\nProfilaktika choralari. " + "Sanitariya nazorati olib boriladi. " * 80)
    chunks = pl.split_chunks(text)
    assert len(chunks) >= 2
    assert all(len(c) >= 120 for c in chunks)
    assert all(len(c) <= pl.CHUNK_CHARS + 50 for c in chunks)
    assert chunks[0].startswith("Botulizm")


def test_context_block_says_protocol_wins_over_textbook():
    block = pl.context_block([{"title": "Botulizm / MKP 2025", "text": "Antitoksin 1-sutkada."}])
    assert "MAJBURIY MANBA" in block
    assert "USTUNLIK" in block
    assert "Botulizm / MKP 2025" in block


def test_context_block_is_empty_without_protocols():
    assert pl.context_block([]) == ""


def test_generation_skips_protocols_for_departments_without_them():
    db = MagicMock()
    with patch.object(ai.rag, "resolve_book_department_id", return_value=7), \
         patch.object(ai.protocols, "has_protocols", return_value=False) as has:
        block, refs = ai._protocol_message(db, "yuqumli-5-s", "Botulizm", "key")
    assert block == "" and refs == [] and has.called


def test_generation_adds_protocol_block_when_department_has_them():
    db = MagicMock()
    chunks = [{"title": "Botulizm / MKP", "text": "Antitoksin 1-sutkada.", "book_id": 5}]
    with patch.object(ai.rag, "resolve_book_department_id", return_value=5), \
         patch.object(ai.protocols, "has_protocols", return_value=True), \
         patch.object(ai.protocols, "retrieve", return_value=chunks):
        block, refs = ai._protocol_message(db, "yuqumli-5-s", "Botulizm", "key")
    assert "MAJBURIY MANBA" in block and refs == [{"title": "Botulizm / MKP", "kind": "protocol"}]


def test_protocol_failure_never_breaks_generation():
    db = MagicMock()
    with patch.object(ai.rag, "resolve_book_department_id", side_effect=RuntimeError("baza yiqildi")):
        assert ai._protocol_message(db, "yuqumli-5-s", "Botulizm", "key") == ("", [])


def test_disease_name_in_topic_selects_that_protocol_folder():
    title = "20. + Yuqumli / Vabo / Vabo_klinik_protokol.pdf"
    assert pl.topic_matches(title, "Vabo bemorini gospitalizatsiya qilish")
    assert pl.topic_matches("arxiv / Botulizm / nat_protokol.pdf", "Botulizmda antitoksin dozasi")
    assert not pl.topic_matches(title, "Qizamiq profilaktikasi")
    # Umumiy so'zlar ("virusli", "o'tkir") o'zi hujjat tanlamaydi.
    assert not pl.topic_matches("arxiv / otkir virusli gepatit E / f.pdf", "O'tkir virusli infeksiya")
    assert pl.topic_matches("arxiv / otkir virusli gepatit E / f.pdf", "O'tkir virusli gepatit E klinikasi")
