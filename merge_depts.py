from core.models import AcademicDepartment, SubjectBook, BookChunk

MERGE_MAP = {
    "endokrinologiya-va-gemotalogiya": "endokrinologiyagemotologiya-va-ftiziatriya-sillabus",
    "epidemiologiya-va-yuqumli-kasalliklar": "epidemiologiya-va-yuqumli-kasalliklar-hamshiralik-ishi",
    "fakultet-va-gospital-jarroxlik": "fakultet-va-gospital-jarrohlik",
    "gospital-terapiya-laboratoriya": "gospital-terapiya",
    "ichki-kasalliklar": "ichki-kasalliklar-propedevtikasi-kafedrasi",
    "mikrobiologiya-va-virusologiya": "mikrobiologiyavirusologiyaimmunologiya",
    "nevrologiya-va-psixiatriya": "nevrologiya-va-psixatriya",
    "patologik-fiziologiya": "patologik-fiziologiya-va-patologik-anatomiya",
    "pediatriya-1": "pediatriya",
    "tibbiy-kimyo": "tibbiy-va-biologik-kimyo",
    "xalq-tabobati": "xalq-tabobati-va-farmakologiya",
}

for wrong_code, correct_code in MERGE_MAP.items():
    wrong = AcademicDepartment.objects.filter(code=wrong_code).first()
    correct = AcademicDepartment.objects.filter(code=correct_code).first()
    if not wrong or not correct:
        print("SKIP", wrong_code, "->", correct_code, "topilmadi: wrong=", bool(wrong), "correct=", bool(correct))
        continue
    n_books = SubjectBook.objects.filter(department=wrong).update(department=correct)
    n_chunks = BookChunk.objects.filter(department=wrong).update(department=correct)
    remaining = wrong.subjects.count() + wrong.books.count()
    print(wrong_code, "->", correct_code, ":", n_books, "kitob,", n_chunks, "chunk kochirildi, qolgan boglanish=", remaining)
    if remaining == 0:
        wrong.delete()
        print("  ", wrong_code, "ochirildi (bosh)")
