"""Malaka oshirish dasturi — online portal ichidagi alohida rejim.

Bir xil jadvallar va bir xil portal, lekin boshqa qoidalar. Fanning
`program` ustuni "malaka" bo'lsa:

  * turlar: ma'ruza matni, taqdimot, video dars, amaliy mashg'ulot, test —
    vaziyatli masala va tarqatma YO'Q;
  * mavzu jonli dars bilan emas, material paydo bo'lishi bilan ochiladi —
    video darsning boshlanish vaqti belgilanmaydi;
  * mavzularni o'qituvchining o'zi qo'shadi;
  * fan boshida kirish testi, oxirida chiqish testi (1 urinishdan);
  * mashg'ulot testi va amaliy mashg'ulot — 4 urinish, eng yaxshisi
    hisoblanadi.

Bu yerda faqat qoidalar va yordamchilar; marshrutlar `routes/malaka.py`
va online marshrutlarning malaka tarmoqlarida.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import re
import struct
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.staff_login import normalize_listener_login
from app.models.online_edu import (
    PROGRAM_KINDS,
    MalakaTestAttempt,
    OnlineMaterial,
    OnlineProgress,
    OnlineSyllabus,
)
from app.services import openai_client as oai
from app.services.online_edu_service import (
    review_test_for_student,
    strip_test_for_student,
    topic_by_code,
)

logger = logging.getLogger(__name__)

PROGRAM = "malaka"

# Fan darajasidagi testlar maxsus mavzu kodlarida turadi. Shunda ular
# oddiy material sifatida saqlanadi va alohida jadval kerak bo'lmaydi.
ENTRY_CODE = "__entry__"
EXIT_CODE = "__exit__"
SUBJECT_TEST_CODES = (ENTRY_CODE, EXIT_CODE)

# Test sifatida topshiriladigan material turlari.
TEST_KINDS = ("test", "practical")

# Urinishlar chegarasi (urinish turi bo'yicha).
MAX_ATTEMPTS = {"test": 4, "practical": 4, "entry": 1, "exit": 1}

# Bitta testdagi savollar chegarasi. Kirish va chiqish testlari 30-50
# savollik bo'ladi; 200 — fayldan xato bilan butun kitob o'qilib ketmasligi uchun.
MAX_QUESTIONS = 200

SUBJECT_TEST_TITLE = {"entry": "Kirish testi", "exit": "Chiqish testi"}

# Pasport login — umumiy qoida `core.staff_login` da, chunki parol
# almashtirishda ham kerak.
normalize_login = normalize_listener_login


# ============================ Qoidalar ============================


def is_malaka(syllabus: OnlineSyllabus | None) -> bool:
    return syllabus is not None and (getattr(syllabus, "program", "") or "online") == PROGRAM


def kinds_for(syllabus: OnlineSyllabus | None) -> tuple[str, ...]:
    program = (getattr(syllabus, "program", "") or "online") if syllabus is not None else "online"
    return PROGRAM_KINDS.get(program, PROGRAM_KINDS["online"])


def attempt_kind(topic_code: str, material_kind: str) -> str:
    """Urinish turi: kirish/chiqish testi mavzu kodidan, qolgani material turidan."""
    code = (topic_code or "").strip()
    if code == ENTRY_CODE:
        return "entry"
    if code == EXIT_CODE:
        return "exit"
    return material_kind


def attempt_lock_key(student_id: str, syllabus_id: int, topic_code: str, kind: str) -> int:
    """Postgres advisory lock kaliti — bitta tinglovchining bitta testi uchun.

    Ikki marta tez bosilgan "Topshirish" ikki so'rov bo'lib keladi va
    ikkalasi ham "3 ta urinish ishlatilgan" deb o'qib, 5-urinishni yozib
    qo'yardi. Qulf sanash va yozishni ketma-ket bajaradi.
    """
    raw = f"malaka|{student_id}|{syllabus_id}|{topic_code}|{kind}".encode()
    return int.from_bytes(hashlib.sha1(raw).digest()[:8], "big", signed=True)


# ============================ Test savollari ============================

# Word'da qalin, tagiga chizilgan yoki bo'yalgan qator shu belgi bilan
# boshlanadi. Ko'p test fayllarida to'g'ri javob aynan shunday ajratiladi
# va oddiy matnga o'tganda bu ma'lumot yo'qolardi.
EMPHASIS_MARK = "✱ "

_LATIN = "ABCDEFGH"
_CYRILLIC = "АБВГДЕЖЗ"


def questions_of(material: OnlineMaterial | None) -> list:
    if material is None:
        return []
    items = (material.payload or {}).get("questions")
    return items if isinstance(items, list) else []


def is_published(material: OnlineMaterial | None) -> bool:
    """Kirish/chiqish testi tinglovchilarga ochiqmi. Oddiy materialda doim ochiq."""
    if material is None:
        return False
    return bool((material.payload or {}).get("published", True))


def _strip_letter_prefixes(options: list[str]) -> list[str]:
    """`A) ...`, `B. ...` belgilarini olib tashlaydi — faqat HAMMA variantda bo'lsa.

    Bittasiga qarab kesilsa, "E. coli bilan zararlanish" degan to'g'ri
    javob "coli bilan zararlanish" bo'lib qolardi.
    """
    if not 2 <= len(options) <= len(_LATIN):
        return options
    matches = []
    for i, option in enumerate(options):
        letters = _LATIN[i] + _LATIN[i].lower() + _CYRILLIC[i] + _CYRILLIC[i].lower()
        matches.append(re.match(r"^\(?\s*[" + letters + r"]\s*[\)\.\:]\s*", option))
    if all(matches):
        return [o[m.end():].strip() for o, m in zip(options, matches)]
    return options


def _clean_question(q: object) -> dict | None:
    """Bitta savolni tekshiradi va tozalaydi; yaroqsiz bo'lsa `None`."""
    if not isinstance(q, dict):
        return None
    question = " ".join(str(q.get("question") or "").split())
    # "12. Savol matni" — raqam savolning bir qismi emas. Nuqtadan keyin
    # bo'sh joy shart: "2.5 mg ..." bilan boshlanadigan savol buzilmasin.
    question = re.sub(r"^\d{1,3}\s*[\.\)]\s+", "", question)
    raw_options = q.get("options")
    if not isinstance(raw_options, list):
        return None
    try:
        idx = int(q.get("correctOptionIndex"))
    except (TypeError, ValueError):
        return None

    mark = EMPHASIS_MARK.strip()
    options: list[str] = []
    new_idx = -1
    for i, raw in enumerate(raw_options):
        text = " ".join(str(raw if raw is not None else "").split())
        if text.startswith(mark):
            text = text[len(mark):].strip()
        if not text:
            # Bo'sh variant tashlanadi; to'g'ri javob indeksi shunga qarab suriladi.
            continue
        if i == idx:
            new_idx = len(options)
        options.append(text)
    options = _strip_letter_prefixes(options)
    if not question or not 2 <= len(options) <= 8 or new_idx < 0:
        return None
    source = "document" if str(q.get("answer_source") or "").lower().startswith("doc") else "ai"
    return {
        "question": question[:2000],
        "options": [o[:600] for o in options],
        "correctOptionIndex": new_idx,
        "explanation": str(q.get("explanation") or "").strip()[:1500],
        "answer_source": source,
    }


def clean_questions(raw: object) -> list[dict]:
    """Saqlanadigan test savollari. Xato bo'lsa — qaysi savol ekanini aytadi."""
    if not isinstance(raw, list) or not raw:
        raise ValueError("Testda savol yo'q.")
    if len(raw) > MAX_QUESTIONS:
        raise ValueError(f"Savollar juda ko'p ({len(raw)}). Chegara {MAX_QUESTIONS} ta.")
    out: list[dict] = []
    for n, item in enumerate(raw, 1):
        if isinstance(item, dict):
            item = {**item, "answer_source": item.get("answer_source") or "document"}
        clean = _clean_question(item)
        if clean is None:
            raise ValueError(
                f"{n}-savol to'liq emas: savol matni, kamida 2 ta variant va "
                "to'g'ri javob belgilangan bo'lishi kerak."
            )
        clean.pop("answer_source", None)
        out.append(clean)
    return out


def validate_material(
    syllabus: OnlineSyllabus, topic_code: str, kind: str, payload: dict | None
) -> dict | None:
    """Material shu dasturda ruxsat etilganmi. Test turlari uchun tozalangan payload.

    `None` — payload o'zgarishsiz saqlanadi.
    """
    allowed = kinds_for(syllabus)
    if kind not in allowed:
        raise ValueError(f"Bu fanda '{kind}' turi yo'q. Ruxsat: {', '.join(allowed)}.")
    if not is_malaka(syllabus):
        return None

    code = (topic_code or "").strip()
    if code in SUBJECT_TEST_CODES:
        if kind != "test":
            raise ValueError("Kirish va chiqish testiga faqat test savollari qo'shiladi.")
    elif topic_by_code(syllabus, "", code) is None:
        raise ValueError("Mavzu topilmadi. Sahifani yangilang.")

    if kind not in TEST_KINDS:
        return None
    data = payload or {}
    out: dict = {"questions": clean_questions(data.get("questions"))}
    if code in SUBJECT_TEST_CODES:
        # Kirish testi odatda darhol ochiladi; chiqish testi esa kurs
        # oxirida — o'qituvchi uni oldindan tayyorlab, keyin e'lon qiladi.
        out["published"] = bool(data.get("published", code == ENTRY_CODE))
    return out


# ============================ Urinishlar ============================


def attempts_for(
    db: Session, *, student_id: str, syllabus_id: int, topic_code: str, kind: str
) -> list[MalakaTestAttempt]:
    return list(
        db.execute(
            select(MalakaTestAttempt)
            .where(
                MalakaTestAttempt.student_id == student_id,
                MalakaTestAttempt.syllabus_id == syllabus_id,
                MalakaTestAttempt.topic_code == topic_code,
                MalakaTestAttempt.kind == kind,
            )
            .order_by(MalakaTestAttempt.attempt_no, MalakaTestAttempt.id)
        ).scalars()
    )


def student_attempts(
    db: Session, student_id: str, syllabus_id: int
) -> dict[tuple[str, str], list[MalakaTestAttempt]]:
    """Tinglovchining fandagi barcha urinishlari: `{(mavzu, tur): [...]}` — bitta so'rov."""
    out: dict[tuple[str, str], list[MalakaTestAttempt]] = {}
    rows = db.execute(
        select(MalakaTestAttempt)
        .where(
            MalakaTestAttempt.student_id == student_id,
            MalakaTestAttempt.syllabus_id == syllabus_id,
        )
        .order_by(MalakaTestAttempt.attempt_no, MalakaTestAttempt.id)
    ).scalars()
    for row in rows:
        out.setdefault((row.topic_code, row.kind), []).append(row)
    return out


def _percent(score: int, total: int) -> int:
    return round((score or 0) * 100 / total) if total else 0


def best_attempt(rows: list) -> object | None:
    """Eng yaxshi urinish; teng bo'lsa — keyingisi."""
    return max(rows, key=lambda r: (_percent(r.score, r.total), r.attempt_no), default=None)


def summarize(rows: list, kind: str) -> dict:
    """Urinishlar xulosasi. Eng yaxshi natija hisoblanadi."""
    limit = MAX_ATTEMPTS.get(kind, 1)
    used = len(rows)
    best = best_attempt(rows)
    last = rows[-1] if rows else None
    return {
        "kind": kind,
        "max_attempts": limit,
        "used": used,
        "left": max(0, limit - used),
        "finished": used >= limit,
        "best_percent": _percent(best.score, best.total) if best else None,
        "best_score": best.score if best else None,
        "best_total": best.total if best else None,
        "last_score": last.score if last else None,
        "last_total": last.total if last else None,
        "last_submitted_at": last.submitted_at if last else None,
    }


def reveal_answers(summary: dict) -> bool:
    """To'g'ri javoblar qachon ochiladi.

    Har urinishdan keyin ochilsa, ikkinchi urinish javobni ko'chirib yozish
    bo'lib qolardi va 4 ta urinish ma'nosini yo'qotardi. Shuning uchun —
    urinishlar tugaganda yoki 100% olinganda (bu yog'iga yashiradigan narsa yo'q).
    """
    return bool(summary.get("finished")) or summary.get("best_percent") == 100


def test_view(questions: list, rows: list, kind: str) -> dict:
    """Tinglovchiga ketadigan test: urinishlar holati va savollar."""
    summary = summarize(rows, kind)
    out: dict = {"attempts": summary, "question_count": len(questions)}
    if reveal_answers(summary):
        best = best_attempt(rows)
        out["questions"] = review_test_for_student(questions)
        out["my_answers"] = list(best.answers or []) if best is not None else []
    else:
        out["questions"] = strip_test_for_student(questions)
    return out


# ============================ Mavzu qulfi ============================


def material_kinds_by_topic(db: Session, syllabus_id: int) -> dict[str, set[str]]:
    """Qaysi mavzuda qaysi material turlari bor — bitta so'rov."""
    out: dict[str, set[str]] = {}
    rows = db.execute(
        select(OnlineMaterial.topic_code, OnlineMaterial.kind)
        .where(OnlineMaterial.syllabus_id == syllabus_id)
        .distinct()
    ).all()
    for code, kind in rows:
        key = str(code or "").strip()
        if key:
            out.setdefault(key, set()).add(str(kind))
    return out


def subject_test(db: Session, syllabus_id: int, code: str) -> OnlineMaterial | None:
    """Fanning kirish yoki chiqish testi."""
    return (
        db.execute(
            select(OnlineMaterial)
            .where(
                OnlineMaterial.syllabus_id == syllabus_id,
                OnlineMaterial.topic_code == code,
                OnlineMaterial.kind == "test",
            )
            .order_by(OnlineMaterial.id)
        )
        .scalars()
        .first()
    )


def entry_gate_open(
    db: Session,
    student_id: str,
    syllabus_id: int,
    attempts: dict[tuple[str, str], list] | None = None,
) -> bool:
    """Mavzular ochiqmi — kirish testi topshirilganmi.

    Kirish testi boshlang'ich darajani o'lchaydi, shuning uchun mavzular
    undan KEYIN ochiladi: aks holda tinglovchi avval o'qib, keyin
    "boshlang'ich" testni yechar va o'lchov ma'nosini yo'qotardi. Test
    qo'yilmagan yoki e'lon qilinmagan bo'lsa — qulf yo'q.
    """
    entry = subject_test(db, syllabus_id, ENTRY_CODE)
    if entry is None or not is_published(entry) or not questions_of(entry):
        return True
    if attempts is not None:
        return bool(attempts.get((ENTRY_CODE, "entry")))
    return bool(
        attempts_for(
            db, student_id=student_id, syllabus_id=syllabus_id,
            topic_code=ENTRY_CODE, kind="entry",
        )
    )


def open_codes(
    db: Session,
    syllabus: OnlineSyllabus,
    student_id: str,
    have: dict[str, set[str]] | None = None,
    attempts: dict[tuple[str, str], list] | None = None,
) -> dict[str, None]:
    """Tinglovchiga ochiq mavzular — online'dagi `open_topic_codes` bilan bir shaklda.

    Malakada jonli dars yo'q: mavzu o'qituvchi material joylashi bilan
    ochiladi (kirish testidan keyin).
    """
    if not entry_gate_open(db, student_id, syllabus.id, attempts):
        return {}
    have = have if have is not None else material_kinds_by_topic(db, syllabus.id)
    return {code: None for code, kinds in have.items() if kinds and code not in SUBJECT_TEST_CODES}


def subject_test_status(
    db: Session, syllabus_id: int, code: str, attempts: dict[tuple[str, str], list]
) -> dict:
    """Kirish yoki chiqish testining tinglovchi uchun holati."""
    material = subject_test(db, syllabus_id, code)
    kind = "entry" if code == ENTRY_CODE else "exit"
    questions = questions_of(material)
    return {
        "available": material is not None and is_published(material) and bool(questions),
        "title": ((material.title or "").strip() if material else "") or SUBJECT_TEST_TITLE[kind],
        "question_count": len(questions),
        **summarize(attempts.get((code, kind), []), kind),
    }


def topic_result(attempts: dict[tuple[str, str], list], code: str, kinds: set[str]) -> dict:
    """Mavzu natijasi: test va amaliy mashg'ulotning eng yaxshi foizi va baho.

    Baho — mavzudagi test turlarining (qaysi biri bor bo'lsa) o'rtachasi va
    faqat HAMMASI topshirilgach chiqadi: bittasi bilan chiqqan baho
    tinglovchiga ikkinchisini bajarmasa ham bo'ladigandek tuyulardi.
    """
    out: dict = {"test": None, "practical": None, "grade": None}
    parts: list[int | None] = []
    for kind in TEST_KINDS:
        rows = attempts.get((code, kind), [])
        if kind in kinds or rows:
            out[kind] = summarize(rows, kind)
        if kind in kinds:
            parts.append(out[kind]["best_percent"])
    if parts and all(p is not None for p in parts):
        out["grade"] = round(sum(p for p in parts if p is not None) / len(parts))
    return out


# ============================ Mavzular ============================


def used_topic_codes(db: Session, syllabus_id: int) -> set[str]:
    """Fanda qachondir ishlatilgan mavzu kodlari — o'chirilganlari ham."""
    codes: set[str] = set()
    for model in (OnlineMaterial, OnlineProgress, MalakaTestAttempt):
        rows = db.execute(
            select(model.topic_code).where(model.syllabus_id == syllabus_id).distinct()
        ).scalars()
        codes.update(str(c).strip() for c in rows if c)
    return codes


def next_topic_code(syllabus: OnlineSyllabus, used: Iterable[str] = ()) -> str:
    """Yangi mavzu kodi: ishlatilgan raqamli kodlarning eng kattasi + 1.

    Izi qolgan kod (materiali, natijasi yoki "ko'rildi" belgisi bo'lgan)
    QAYTA berilmaydi — aks holda eski natijalar yangi mavzuga yopishib qolardi.
    """
    values = [str(t.get("code") or "") for t in (syllabus.topics or []) if isinstance(t, dict)]
    values.extend(used)
    nums: list[int] = []
    for value in values:
        try:
            nums.append(int(str(value).strip()))
        except ValueError:
            continue
    return str(max(nums, default=0) + 1)


# ============================ Fayldan matn ============================

IMPORT_EXTENSIONS = (".docx", ".doc", ".pdf", ".txt")
# Juda katta faylda AI javobi bo'linib ketadi va narxi oshadi. Bir test
# to'plami odatda 30-60 ming belgidan oshmaydi.
MAX_IMPORT_CHARS = 150_000


def extract_text(filename: str, content: bytes) -> str:
    name = (filename or "").lower()
    if name.endswith(".docx"):
        return _docx_text(content)
    if name.endswith(".doc"):
        return _doc_text(content)
    if name.endswith(".pdf"):
        return _pdf_text(content)
    if name.endswith(".txt"):
        return _plain_text(content)
    raise ValueError("Fayl turi qo'llab-quvvatlanmaydi. Word (.docx, .doc), PDF yoki matn (.txt) yuklang.")


def _docx_text(content: bytes) -> str:
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    doc = Document(io.BytesIO(content))
    out: list[str] = []
    # Paragraf va jadvallar HUJJATDAGI tartibda — savol jadvalda, javob
    # kaliti matnda bo'lishi mumkin.
    for child in doc.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            par = Paragraph(child, doc)
            text = par.text.strip()
            if not text:
                continue
            runs = [r for r in par.runs if r.text.strip()]
            emphasized = bool(runs) and any(
                r.bold or r.underline or r.font.highlight_color is not None for r in runs
            )
            out.append((EMPHASIS_MARK if emphasized else "") + text)
        elif tag == "tbl":
            table = Table(child, doc)
            for row in table.rows:
                cells: list[str] = []
                for cell in row.cells:
                    value = cell.text.strip()
                    # Birlashtirilgan katak python-docx da takrorlanadi.
                    if value and (not cells or cells[-1] != value):
                        cells.append(value)
                if cells:
                    out.append(" | ".join(cells))
    return "\n".join(out)


def _pdf_text(content: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(content))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def _doc_text(content: bytes) -> str:
    """Word 97-2003 (.doc) — ichki bo'laklar jadvali (piece table) bo'yicha.

    Serverdagi LibreOffice'da Writer moduli yo'q, shuning uchun .doc ni
    o'zimiz o'qiymiz: FIB -> CLX -> PlcPcd. Har bo'lak 8-bitli (cp1252)
    yoki UTF-16LE bo'ladi.
    """
    import olefile

    ole = olefile.OleFileIO(io.BytesIO(content))
    wd = ole.openstream("WordDocument").read()
    flags = struct.unpack_from("<H", wd, 0x0A)[0]
    table = ole.openstream("1Table" if flags & 0x0200 else "0Table").read()
    fc_clx, lcb_clx = struct.unpack_from("<II", wd, 0x01A2)
    clx = table[fc_clx:fc_clx + lcb_clx]
    i = 0
    while i < len(clx) and clx[i] == 0x01:
        i += 3 + struct.unpack_from("<H", clx, i + 1)[0]
    if i >= len(clx) or clx[i] != 0x02:
        raise ValueError("Word fayli o'qilmadi. Uni .docx sifatida saqlab, qayta yuklang.")
    lcb = struct.unpack_from("<I", clx, i + 1)[0]
    plc = clx[i + 5:i + 5 + lcb]
    n = (lcb - 4) // 12
    cps = struct.unpack_from("<%dI" % (n + 1), plc, 0)
    pcds = plc[4 * (n + 1):]
    parts: list[str] = []
    for k in range(n):
        length = cps[k + 1] - cps[k]
        fc = struct.unpack_from("<I", pcds, k * 8 + 2)[0]
        if fc & 0x40000000:
            off = (fc & ~0x40000000) // 2
            parts.append(wd[off:off + length].decode("cp1252", errors="replace"))
        else:
            parts.append(wd[fc:fc + 2 * length].decode("utf-16le", errors="replace"))
    # \x07 — jadval katagi, \r — paragraf.
    return "".join(parts).replace("\x07", " | ").replace("\r", "\n")


def _plain_text(content: bytes) -> str:
    for enc in ("utf-8-sig", "cp1251"):
        try:
            return content.decode(enc)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="replace")


# ============================ AI: savollarni ajratish ============================

_QUESTION_START = re.compile(r"^\s*(\d{1,3}\s*[\.\)]|\+{3,}|#?\s*savol|question)", re.IGNORECASE)

_SYSTEM = (
    "You extract MULTIPLE-CHOICE TEST QUESTIONS from a document for a medical university. "
    "The document can have ANY layout: numbered questions with lettered options; the HEMIS "
    "format (++++ separates questions, ==== separates options, # marks the correct option); "
    "tables; an answer key at the end ('1-B, 2-A', 'Javoblar:'); a '+' before the correct "
    "option; 'Javob: C' lines. A line starting with the mark "
    + json.dumps(EMPHASIS_MARK.strip())
    + " was bold, underlined or highlighted in the original — in many test files that is how "
    "the correct option is shown. "
    "For each question return: question (the text only, without its number), options (the "
    "answer texts WITHOUT letter prefixes, in the original order, 2 to 8 items), "
    "correctOptionIndex (0-based), explanation (one short sentence, or empty), and "
    "answer_source: 'document' if the document itself indicates the correct option, otherwise "
    "'ai' — in that case choose the correct option yourself, reading and understanding the "
    "question. Do NOT invent questions that are not in the text and do NOT change their "
    "wording or language. Skip headings, instructions and anything that is not a question. "
    # OpenAI json_object rejimi promptda "json" so'zi bo'lishini talab qiladi —
    # busiz har so'rov 400 bilan qaytadi.
    'Return ONLY a JSON object of the form {"questions": [...]}.'
)


def _chunks(text: str, size: int = 9000) -> list[str]:
    """Matnni bo'laklarga bo'ladi — savol O'RTASIDAN kesmasdan."""
    out: list[str] = []
    buf: list[str] = []
    length = 0
    for line in text.split("\n"):
        starts_question = bool(_QUESTION_START.match(line))
        if length >= size and (starts_question or length >= size * 1.5):
            out.append("\n".join(buf))
            buf, length = [], 0
        buf.append(line)
        length += len(line) + 1
    if buf:
        out.append("\n".join(buf))
    return [c for c in out if c.strip()]


def _parse_chunk(api_key: str, model: str, chunk: str) -> list | None:
    """Bitta bo'lak. Xato bo'lsa `None` — bitta bo'lak butun importni yiqitmasin."""
    try:
        raw = oai.generate_openai_chat(
            api_key,
            messages=[{"role": "system", "content": _SYSTEM}, {"role": "user", "content": chunk}],
            model=model,
            max_tokens=12000,
            temperature=0.0,
            timeout_sec=240,
            response_format={"type": "json_object"},
            usage_kind="malaka_test_import",
        )
        items = (json.loads(raw or "{}") or {}).get("questions")
    except Exception as exc:  # noqa: BLE001
        logger.warning("malaka test importi: bo'lak o'qilmadi: %s", exc)
        return None
    return items if isinstance(items, list) else []


def parse_questions(text: str) -> dict:
    """Hujjat matnidan test savollarini ajratadi.

    Natija SAQLANMAYDI — o'qituvchiga ko'rish uchun qaytadi. AI to'g'ri
    javobni o'zi tanlagan savollar `answer_source: "ai"` bilan belgilanadi:
    o'qituvchi ularni tekshirishi kerak.
    """
    settings = get_settings()
    api_key = (settings.openai_api_key or "").strip()
    if not api_key:
        raise RuntimeError("AI xizmati sozlanmagan. Administratorga murojaat qiling.")

    text = (text or "").strip()
    if not text:
        raise ValueError(
            "Fayldan matn olinmadi. Fayl skanerlangan rasm bo'lishi mumkin — matnli nusxasini yuklang."
        )
    truncated = len(text) > MAX_IMPORT_CHARS
    text = text[:MAX_IMPORT_CHARS]

    model = (settings.openai_chat_model or "").strip() or "gpt-4.1-nano"
    chunks = _chunks(text)
    # Bo'laklar parallel o'qiladi: 60 savollik fayl ketma-ket 3-4 daqiqa
    # olardi va o'qituvchi sahifa qotib qoldi deb o'ylardi.
    with ThreadPoolExecutor(max_workers=max(1, min(4, len(chunks)))) as pool:
        results = list(pool.map(lambda c: _parse_chunk(api_key, model, c), chunks))

    questions: list[dict] = []
    seen: set[str] = set()
    failed = 0
    for items in results:
        if items is None:
            failed += 1
            continue
        for item in items:
            clean = _clean_question(item)
            if clean is None:
                continue
            key = re.sub(r"\W+", "", clean["question"].lower())[:200]
            if key in seen:
                continue
            seen.add(key)
            questions.append(clean)

    if not questions and failed:
        raise RuntimeError("AI hozir javob bermadi. Birozdan keyin qayta urinib ko'ring.")
    kept = questions[:MAX_QUESTIONS]
    return {
        "questions": kept,
        "ai_decided": sum(1 for q in kept if q["answer_source"] == "ai"),
        "truncated": truncated or len(questions) > MAX_QUESTIONS,
        "chunks": len(chunks),
        "failed_chunks": failed,
    }
