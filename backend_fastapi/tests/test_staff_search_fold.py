"""Xodim qidiruvidagi imlo chidamliligi.

Haqiqiy holat: administrator "Ahmadaliyev Shohruh" degan o'qituvchini
qidirgan, bazada esa "Shoxrux Ahmadaliyev" yozilgan. Hech narsa topilmagan
va o'qituvchi ro'yxatga qo'shilmay qolgan.

O'zbek lotinida bir ism bir necha xil yoziladi va bazada qaysi shakl
turgani oldindan ma'lum emas — shuning uchun taqqoslashdan oldin ikkala
tomon bitta shaklga keltiriladi.
"""

import pytest

from app.api.routes.online_admin import _fold_text


class TestFoldText:
    @pytest.mark.parametrize(
        "a,b",
        [
            # Aynan shu holat ro'yxatga qo'shishni to'sib qo'ygan edi.
            ("Shohruh", "Shoxrux"),
            ("Shohrux", "Shoxruh"),
            ("Ahmadaliyev", "Axmadaliyev"),
            ("Ahmadaliyev", "Ahmadaliev"),
            ("Axmadaliyev", "Ahmadaliev"),
            # Apostrofning har xil belgilari.
            ("G'ulom", "Gulom"),
            ("G‘ulom", "Gulom"),
            ("G’ulom", "G'ulom"),
            ("Oʻktam", "Oktam"),
            # Registr farqi.
            ("SHOXRUX", "shohruh"),
        ],
    )
    def test_bir_xil_shaklga_keladi(self, a, b):
        assert _fold_text(a) == _fold_text(b)

    def test_har_xil_ismlar_qorishmaydi(self):
        # Chidamlilik hamma narsani bir xil qilib yubormasligi kerak.
        assert _fold_text("Ahmadaliyev") != _fold_text("Mamadaliyev")
        assert _fold_text("Shohruh") != _fold_text("Shohrat")
        assert _fold_text("Qosimov") != _fold_text("Qodirov")

    def test_bo_sh_va_yaroqsiz_kiritma(self):
        assert _fold_text("") == ""
        assert _fold_text(None) == ""
        assert _fold_text("   ") == "   "

    def test_raqamlar_o_zgarmaydi(self):
        # Telefon raqami bo'yicha qidiruv ham ishlashi kerak.
        assert _fold_text("998905633006") == "998905633006"

    def test_haqiqiy_juftlik(self):
        # Bazadagi yozuv va adminning yozgani.
        bazada = _fold_text("Shoxrux Ahmadaliyev")
        yozgani = _fold_text("Shohruh")
        familiya = _fold_text("ahmadaliyev")
        assert yozgani in bazada
        assert familiya in bazada
