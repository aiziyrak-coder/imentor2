"""Qidiruvdagi foydasiz parchalar filtri.

Korpusda 14 873 ta (1.95%) juda qisqa yozuv bor — OCR chiqindisi, ba'zilari
bitta belgidan iborat (".", "s"). Ularning vektorlari mazmunsiz bo'lgani
uchun ISTALGAN savolga yaqin chiqishi mumkin va haqiqiy matnni siqib
chiqaradi. Bir sinovda 30 nomzoddan atigi 127 belgi foydali matn qolgan edi.
"""

from app.services.book_retrieval import MIN_CHUNK_CHARS, dedupe_chunks, focus_window


def chunk(text, title="Darslik", page="10"):
    return {"book_title": title, "page": page, "text": text}


class TestMinChunkChars:
    def test_chegara_oqilona(self):
        # 200 belgi — taxminan bitta to'liq abzas. Undan qisqasi generatsiyaga
        # kontekst bermaydi.
        assert 100 <= MIN_CHUNK_CHARS <= 500

    def test_chiqindi_namunalari_chegaradan_past(self):
        # Bazadan olingan haqiqiy namunalar.
        for junk in (".", "s", "  ", "12", "Chapter 4"):
            assert len(junk) < MIN_CHUNK_CHARS

    def test_haqiqiy_abzas_chegaradan_yuqori(self):
        real = (
            "Yurak yetishmovchiligi - yurakning qon haydash qobiliyati "
            "pasayishi natijasida to'qimalarga yetarli kislorod yetkazib "
            "berilmasligi bilan kechadigan klinik sindrom. Asosiy belgilari: "
            "nafas qisilishi, charchoq, oyoqlarda shish va jismoniy yuklamaga "
            "chidamlilikning pasayishi."
        )
        assert len(real) >= MIN_CHUNK_CHARS


class TestFilterBilanBirga:
    """Filtr, takror va oyna birgalikda ishlaganda natija mazmunli qoladi."""

    def test_chiqindi_tashlangach_matn_qoladi(self):
        real = "Yurak yetishmovchiligi belgilari. " * 12
        raw = [chunk("."), chunk("s"), chunk(real), chunk(real), chunk("boshqa " * 40)]
        # Baza darajasidagi filtrni taqlid qilamiz.
        kept = [c for c in raw if len(c["text"]) >= MIN_CHUNK_CHARS]
        picked = dedupe_chunks(kept, 10)
        assert len(picked) == 2
        assert all(len(c["text"]) >= MIN_CHUNK_CHARS for c in picked)

    def test_filtrsiz_chiqindi_o_rin_egallardi(self):
        # Filtr bo'lmaganda: 4 ta yozuvdan 3 tasi chiqindi bo'lib, model
        # amalda bitta parcha ko'rardi.
        raw = [chunk("."), chunk("s"), chunk(".."), chunk("Haqiqiy matn. " * 20)]
        assert len(dedupe_chunks(raw, 10)) == 4
        kept = [c for c in raw if len(c["text"]) >= MIN_CHUNK_CHARS]
        assert len(dedupe_chunks(kept, 10)) == 1

    def test_oyna_filtrdan_keyin_ham_ishlaydi(self):
        long_text = ". ".join(f"Yurak haqida {i}-jumla" for i in range(300))
        out = focus_window(long_text, "yurak")
        assert len(out) > MIN_CHUNK_CHARS
