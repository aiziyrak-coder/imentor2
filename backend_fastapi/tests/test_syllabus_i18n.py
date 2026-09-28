

def test_russian_with_untranslatable_product_names_is_accepted():
    """2026-09-23: "Internet Explorer, Mozilla Firefox, Google Chrome" bor sarlavhaning
    to'g'ri ruscha tarjimasi lotin harflari ko'pligi uchun rad etilardi."""
    from app.services.syllabus_i18n import looks_wrong_language

    src = "Elektron pochta (E-mail). Web brauzerlar (Internet Explorer, Mozilla Firefox, Google Chrome, Opera)"
    dst = "Электронная почта (E-mail). Веб-браузеры (Internet Explorer, Mozilla Firefox, Google Chrome, Opera)"
    assert looks_wrong_language(dst, "ru") is True  # manbasiz — eski xatti-harakat
    assert looks_wrong_language(dst, "ru", src) is False
    # Inglizcha javob baribir rad etiladi.
    assert looks_wrong_language("Email basics. Web browsers (Internet Explorer, Opera)", "ru", src) is True
