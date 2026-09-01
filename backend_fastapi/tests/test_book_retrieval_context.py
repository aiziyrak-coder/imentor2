"""RAG kontekstini siqish — takrorni tashlash va kerakli oynani kesish.

Bu ikki funksiya promptga ketadigan matnni belgilaydi, ya'ni ular ham
token sarfini, ham javob sifatini bevosita hal qiladi. Shu sababli ular
alohida, bazasiz sinaladi.

Asosiy talab: **ma'lumot yo'qolmasin**. Takror tashlanadi, lekin uning
o'rniga navbatdagi NOYOB parcha qo'yiladi — ya'ni model baribir `top_k`
ta manba ko'radi, faqat endi ular haqiqatan har xil bo'ladi.
"""

from app.services.book_retrieval import (
    FOCUS_WINDOW_CHARS,
    dedupe_chunks,
    focus_window,
)


def chunk(text, title="Darslik", page="10"):
    return {"book_title": title, "page": page, "text": text}


class TestDedupeChunks:
    def test_bir_xil_matn_bir_marta_qoladi(self):
        out = dedupe_chunks([chunk("aynan bir xil"), chunk("aynan bir xil")], 10)
        assert len(out) == 1

    def test_boshqa_kitobdagi_nusxa_ham_tashlanadi(self):
        # Korpusda bitta kitob bir necha marta yuklangan: sarlavha boshqa,
        # matn aynan bir xil. Sarlavhaga qarab filtrlasak, ular o'tib ketardi.
        out = dedupe_chunks(
            [chunk("matn", title="A kitob"), chunk("matn", title="B kitob")], 10
        )
        assert len(out) == 1

    def test_faqat_bo_shliq_farqi_ham_takror(self):
        out = dedupe_chunks([chunk("bir  ikki\nuch"), chunk("bir ikki uch")], 10)
        assert len(out) == 1

    def test_registr_farqi_ham_takror(self):
        out = dedupe_chunks([chunk("Teri Qatlamlari"), chunk("teri qatlamlari")], 10)
        assert len(out) == 1

    def test_noyoblar_saqlanadi_va_tartib_buzilmaydi(self):
        out = dedupe_chunks([chunk("bir"), chunk("ikki"), chunk("uch")], 10)
        assert [c["text"] for c in out] == ["bir", "ikki", "uch"]

    def test_takror_o_rniga_keyingi_noyob_olinadi(self):
        # ENG MUHIM: 3 ta so'ralsa, 3 ta NOYOB qaytishi kerak - takror
        # tufayli manbalar soni kamayib qolmasin.
        raw = [chunk("a"), chunk("a"), chunk("b"), chunk("a"), chunk("c"), chunk("d")]
        out = dedupe_chunks(raw, 3)
        assert [c["text"] for c in out] == ["a", "b", "c"]

    def test_limit_hurmat_qilinadi(self):
        out = dedupe_chunks([chunk(str(i)) for i in range(50)], 5)
        assert len(out) == 5

    def test_bo_sh_va_yaroqsiz_yozuvlar_tashlanadi(self):
        out = dedupe_chunks([None, "matn emas", chunk(""), chunk("   "), chunk("bor")], 10)
        assert [c["text"] for c in out] == ["bor"]

    def test_bo_sh_ro_yxat(self):
        assert dedupe_chunks([], 10) == []


class TestFocusWindow:
    def test_kichik_matn_o_zgarmaydi(self):
        text = "Qisqa parcha."
        assert focus_window(text, "parcha") == text

    def test_natija_chegaradan_oshmaydi(self):
        text = ". ".join(f"Gap raqami {i} haqida matn" for i in range(400))
        out = focus_window(text, "raqami")
        # Oyna gap chegarasida tugagani uchun bitta gapcha oshishi mumkin.
        assert len(out) <= FOCUS_WINDOW_CHARS + 120

    def test_savolga_mos_joy_tanlanadi(self):
        boshi = ". ".join("Aloqasiz umumiy jumla" for _ in range(120))
        kerakli = "Psoriaz teri kasalligi boʻlib surunkali kechadi"
        oxiri = ". ".join("Yana aloqasiz jumla" for _ in range(120))
        out = focus_window(f"{boshi}. {kerakli}. {oxiri}.", "psoriaz kasalligi")
        assert "Psoriaz" in out

    def test_gap_o_rtasidan_kesilmaydi(self):
        text = ". ".join(f"Bu {i}-jumla va u toʻliq yozilgan" for i in range(300))
        out = focus_window(text, "jumla")
        # Kesilganini bildiruvchi "…" dan tashqari qoldiq bo'lmasin.
        core = out.strip("… ").strip()
        assert core.endswith("yozilgan") or core.endswith("yozilgan.")

    def test_kesilgani_bildiriladi(self):
        text = ". ".join("Bir xil jumla takrorlanadi" for _ in range(300))
        out = focus_window(text, "mutlaqo boshqa atama")
        assert "…" in out

    def test_mos_so_z_bo_lmasa_ham_matn_qaytadi(self):
        text = ". ".join(f"Jumla {i}" for i in range(500))
        out = focus_window(text, "hech qanday mos kelmaydigan atama")
        assert len(out) > 100

    def test_bo_sh_savol_yiqitmaydi(self):
        text = ". ".join(f"Jumla {i}" for i in range(500))
        assert len(focus_window(text, "")) > 100

    def test_bo_sh_matn(self):
        assert focus_window("", "savol") == ""

    def test_qatorlar_bilan_ajratilgan_matn(self):
        text = "\n".join(f"Qator {i} matni" for i in range(400))
        out = focus_window(text, "qator")
        assert len(out) <= FOCUS_WINDOW_CHARS + 120


class TestBirgalikda:
    def test_takror_va_uzun_matn_birga(self):
        """Haqiqiy holat: uzun, qisman takroriy natijalar to'plami."""
        uzun = ". ".join(f"Dermatit haqida {i}-jumla" for i in range(300))
        raw = [chunk(uzun), chunk(uzun), chunk("Boshqa qisqa parcha"), chunk(uzun)]
        picked = dedupe_chunks(raw, 3)
        assert len(picked) == 2  # faqat ikkita noyob matn bor edi
        siqilgan = [focus_window(c["text"], "dermatit") for c in picked]
        assert all(len(t) <= FOCUS_WINDOW_CHARS + 120 for t in siqilgan)
        # Siqilgandan keyin ham mazmun qoladi.
        assert "Dermatit" in siqilgan[0]
