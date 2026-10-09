from __future__ import annotations

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.content import CourseSyllabus
from app.models.live_test import LiveTestDraft, LiveTestSession, LiveTestSubmission


def score_submission(questions: list, answers: list) -> tuple[int, int]:
    """To'g'ri javoblar sonini hisoblaydi (savol.correctOptionIndex bilan solishtirib)."""
    total = len(questions) if isinstance(questions, list) else 0
    if not total or not isinstance(answers, list):
        return 0, total
    correct = 0
    for i, q in enumerate(questions):
        if i >= len(answers) or not isinstance(q, dict):
            continue
        try:
            if int(q.get("correctOptionIndex", -1)) == int(answers[i]):
                correct += 1
        except (TypeError, ValueError):
            continue
    return correct, total


def subject_names_for_codes(db: Session, codes: set[str]) -> dict[str, str]:
    if not codes:
        return {}
    rows = db.execute(
        select(CourseSyllabus.subject_code, CourseSyllabus.subject_name).where(
            CourseSyllabus.subject_code.in_(codes)
        )
    ).all()
    return {code: name for code, name in rows}


def questions_of(session: LiveTestSession) -> list[dict]:
    payload = session.payload if isinstance(session.payload, dict) else {}
    raw = payload.get("questions", [])
    return raw if isinstance(raw, list) else []


def strip_questions_for_student(questions: list[dict]) -> list[dict]:
    stripped: list[dict] = []
    for q in questions:
        if not isinstance(q, dict):
            continue
        item: dict = {
            "question": q.get("question", ""),
            "options": q.get("options", []) if isinstance(q.get("options"), list) else [],
        }
        refs = q.get("references")
        if isinstance(refs, list) and refs:
            item["references"] = refs
        stripped.append(item)
    return stripped


def build_wrong_answers(questions: list[dict]) -> list[int]:
    answers: list[int] = []
    for q in questions:
        if not isinstance(q, dict):
            answers.append(0)
            continue
        correct = int(q.get("correctOptionIndex", 0))
        options = q.get("options", [])
        count = len(options) if isinstance(options, list) else 0
        if count <= 0:
            answers.append(0)
            continue
        wrong = 0
        for idx in range(count):
            if idx != correct:
                wrong = idx
                break
        answers.append(wrong)
    return answers


def is_complete_draft(answers: list, question_count: int) -> bool:
    if question_count <= 0:
        return False
    if not isinstance(answers, list) or len(answers) != question_count:
        return False
    return all(isinstance(a, int) and a >= 0 for a in answers)


def submissions_payload(session: LiveTestSession) -> list[dict]:
    return [
        {
            "first_name": s.first_name,
            "last_name": s.last_name,
            "student_id": s.student_id or "",
            "answers": s.answers,
            "submitted_at": s.submitted_at.isoformat(),
        }
        for s in session.submissions
    ]


def normalize_answers(raw, question_count: int) -> list[int]:
    """Talaba BELGILAGAN javoblar; belgilanmagan yoki yaroqsiz o'rin: -1."""
    out: list[int] = []
    for i in range(max(0, question_count)):
        value = raw[i] if isinstance(raw, list) and i < len(raw) else -1
        ok = isinstance(value, int) and not isinstance(value, bool) and value >= 0
        out.append(value if ok else -1)
    return out


def answered_count(answers) -> int:
    if not isinstance(answers, list):
        return 0
    return sum(1 for a in answers if isinstance(a, int) and not isinstance(a, bool) and a >= 0)


def _name_key(first: str, last: str) -> tuple[str, str] | None:
    first, last = (first or "").strip().casefold(), (last or "").strip().casefold()
    return (first, last) if first and last else None


def finalize_live_test_session(db: Session, session: LiveTestSession, *,
                               expired_at: dt.datetime | None = None) -> int:
    """Qoralamalarni topshiriqqa aylantiradi va sessiyani yopadi (transaction ichida).

    Yechib ulgurmagan talaba BELGILAGAN javoblari bilan baholanadi, belgilamagani
    noto'g'ri sanaladi. Ilgari to'liq bo'lmagan qoralama butunlay noto'g'ri
    javoblar bilan almashtirilardi: 10 savoldan 9 tasini to'g'ri belgilagan
    talaba ham 0 ball olardi (7 kunda 907 avtomatik topshiriqning 772 tasi).

    `expired_at` — o'qituvchi yopmagan, muddati o'tgan sessiya: topshiriq
    vaqti qoralamaning oxirgi saqlangan vaqti bo'ladi (boshqa kun statistikasiga
    tushib ketmasin).
    """
    locked = db.execute(
        select(LiveTestSession).where(LiveTestSession.id == session.id).with_for_update()
    ).scalar_one_or_none()
    if locked is None or locked.is_closed:
        return 0

    question_count = len(questions_of(locked))
    now = dt.datetime.now(dt.timezone.utc)

    submitted_keys = {s.participant_key for s in locked.submissions if s.participant_key}
    submitted_students = {s.student_id for s in locked.submissions if s.student_id}
    submitted_names = {k for k in (_name_key(s.first_name, s.last_name) for s in locked.submissions) if k}

    # Bitta talabaning bir nechta qoralamasi bo'lsa (ikkinchi oyna, boshqa
    # qurilma) — eng ko'p javob belgilangani olinadi.
    drafts = sorted(locked.drafts, key=lambda d: (answered_count(d.answers), d.updated_at), reverse=True)

    auto_count = 0
    for draft in drafts:
        if draft.participant_key in submitted_keys:
            continue
        student_id = (draft.student_id or "").strip()
        name = _name_key(draft.first_name, draft.last_name)
        if student_id:
            if student_id in submitted_students:
                continue  # o'zi topshirgan yoki boshqa qoralamasi olingan
        elif name and name in submitted_names:
            # Eski qoralama (talaba ID'siz): shu ismli talaba topshirib bo'lgan.
            continue

        sub = LiveTestSubmission(
            session_id=locked.id,
            first_name=(draft.first_name or "").strip() or "Noma'lum",
            last_name=(draft.last_name or "").strip() or "Talaba",
            answers=normalize_answers(draft.answers, question_count),
            participant_key=draft.participant_key,
            student_id=student_id,
            submitted_at=(draft.updated_at or now) if expired_at else now,
        )
        db.add(sub)
        db.flush()
        from app.services.analytics_service import create_student_attempt_from_submission

        create_student_attempt_from_submission(db, session=locked, submission=sub)
        submitted_keys.add(draft.participant_key)
        if student_id:
            submitted_students.add(student_id)
        if name:
            submitted_names.add(name)
        auto_count += 1

    locked.is_closed = True
    locked.closed_at = expired_at or now
    db.commit()
    db.refresh(locked)
    return auto_count


def finalize_expired_sessions(db: Session, owner_key: str, ttl: dt.timedelta) -> int:
    """O'qituvchi yopishni unutgan, muddati o'tgan sessiyalarni yakunlaydi.

    Ularda yechib, lekin "topshirish"ni bosmagan talabalarning qoralamalari
    hech qachon natijaga aylanmasdi (7 kunda 319 sessiyada 986 ta qoralama).
    """
    now = dt.datetime.now(dt.timezone.utc)
    rows = db.execute(
        select(LiveTestSession).where(
            LiveTestSession.owner_key == owner_key,
            LiveTestSession.is_closed.is_(False),
            LiveTestSession.created_at < now - ttl,
            LiveTestSession.created_at > now - dt.timedelta(days=30),
        )
    ).scalars().all()
    total = 0
    for row in rows:
        total += finalize_live_test_session(db, row, expired_at=row.created_at + ttl)
    return total
