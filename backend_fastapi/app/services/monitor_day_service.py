"""Monitorli xonalar: BITTA KUN, har bir dars uchun alohida javob (2026-10-09).

Rektor shikoyati: "hammasi umumiy, 'tekshirish kerak' deydi, nimagaligi aniq
emas. Har bir monitorli xonadagi har bir o'qituvchiga aniq tahlil kerak —
nega degan savolga javob. 4 ta darsi bo'lsa, har bir darsi bo'yicha alohida."

Shuning uchun bu yerda umumiy ko'rsatkich YO'Q: har dars bitta qator va har
qatorda sabab yozilgan. Sabab taxmin emas — quyidagilardan kelib chiqadi:

  * dars jadvali       — HEMIS (xona, vaqt, o'qituvchi, fan, guruh),
  * xona doskasi       — interaktiv doska inventari (`monitor_id`),
  * ishlangan vaqt     — faollik qaydlari (`lesson_report_service.work_map`),
  * mavzu              — o'qituvchi biriktirgan sillabus tematikasi,
  * xona holati        — o'sha kun o'sha xonada boshqa o'qituvchi
                         darsni to'liq o'tganmi (monitor ishlayaptimi).

Oxirgisi eng muhimi: monitor ishlamayotgan bo'lsa, ayb o'qituvchida emas.
Shu sababli "ochmagan" darslar ikkiga ajratiladi: xonasi ishlayotgani
isbotlangan (bahona yo'q) va avval xona tekshirilishi kerak.
"""

from __future__ import annotations

import datetime as dt
import re
from collections import defaultdict

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.content import CourseSyllabus, StaffCourseSelection
from app.services import lesson_evidence
from app.services import lesson_report_service as lr
from app.services import monitor_schedule_service as ms
from app.services.dean_access import in_groups

#: Fan nomini sillabus nomi bilan solishtirish uchun eng kam moslik.
#: HEMIS fanni qisqa yozadi ("Mikrobiologiya"), sillabus esa to'liq
#: ("Davolash ishi 2 kurs (Milliy) 3-semestr Mikrobiologiya"), shuning uchun
#: AYNAN tenglik ishlamaydi: jonli ma'lumotda 65 fandan 0 tasi aynan mos
#: keldi (2026-10-09). So'z qamrovi bilan 449 darsdan 335 tasi topildi.
MATCH = 0.5


def _words(value: str) -> set[str]:
    text_ = re.sub(r"[^a-z0-9Ѐ-ӿ ]+", " ",
                   str(value or "").lower().replace("ʻ", "").replace("‘", "").replace("’", ""))
    return {w for w in text_.split() if len(w) > 3}


# ----------------------------------------------------------------- mavzu
def _syllabi(db: Session, owners: set[str]) -> dict[str, list[tuple]]:
    """Har o'qituvchining O'ZI biriktirgan fanlari: (nom, mavzular, so'zlar)."""
    if not owners:
        return {}
    rows = db.execute(
        select(StaffCourseSelection.owner_key, CourseSyllabus.subject_name, CourseSyllabus.topics)
        .join(CourseSyllabus, CourseSyllabus.id == StaffCourseSelection.syllabus_id)
        .where(StaffCourseSelection.owner_key.in_(owners))
    ).all()
    out: dict[str, list[tuple]] = defaultdict(list)
    for owner, name, topics in rows:
        out[owner].append((name or "", list(topics or []), _words(name)))
    return out


def _topic_list(topics: list, lesson_type: str) -> list[dict]:
    """Dars turiga mos mavzular: ma'ruzaning tematikasi amaliyotdan boshqa."""
    kind = "lecture" if "ruza" in (lesson_type or "").lower() else "practical"
    typed = [t for t in topics if isinstance(t, dict) and str(t.get("type") or "") == kind]
    return typed or [t for t in topics if isinstance(t, dict)]


def _topic_for(lesson, order: int, syllabi: list[tuple]) -> dict:
    """Shu darsda qaysi mavzu o'tilishi kerak edi.

    Mavzu HEMIS'da yo'q, shuning uchun tematikadagi TARTIB bo'yicha olinadi:
    o'qituvchining shu fan va shu guruh bilan nechanchi darsi bo'lsa,
    tematikadan o'shanchi mavzu. Sillabus topilmasa — shuning o'zi javob:
    o'qituvchi fanni biriktirmagan yoki tematikasi yo'q.
    """
    want = _words(lesson.subject_name)
    best = None
    for name, topics, nw in syllabi:
        if not want or not topics:
            continue
        score = len(want & nw) / len(want)
        if best is None or score > best[0]:
            best = (score, name, topics)
    if best is None or best[0] < MATCH:
        return {"topic": "", "syllabus": (best[1] if best else ""), "index": None,
                "total": 0, "note": "Sillabus topilmadi — o'qituvchi bu fanni biriktirmagan."}
    _, name, topics = best
    typed = _topic_list(topics, lesson.lesson_type)
    if not typed:
        return {"topic": "", "syllabus": name, "index": None, "total": 0,
                "note": "Sillabusda bu dars turiga mavzu yozilmagan."}
    i = min(order, len(typed) - 1)
    item = typed[i]
    return {"topic": str(item.get("title") or "").strip(),
            "topic_id": str(item.get("id") or ""),
            "syllabus": name, "index": i + 1, "total": len(typed),
            "note": "" if order < len(typed) else "Tematika tugagan — tartib bo'yicha oxirgi mavzu."}


# --------------------------------------------------------------- fakultet
def _faculty_of_group(db: Session) -> dict[str, str]:
    """Guruh -> fakultet. HEMIS darsida fakultet yo'q, talabada bor."""
    rows = db.execute(text(
        "select group_name, faculty_name, count(*) from core_studentcontingent "
        "where coalesce(group_name,'') <> '' and coalesce(faculty_name,'') <> '' "
        "group by 1,2"
    )).all()
    best: dict[str, tuple[int, str]] = {}
    for group, faculty, n in rows:
        if group not in best or n > best[group][0]:
            best[group] = (n, faculty)
    return {g: f for g, (_, f) in best.items()}


# ----------------------------------------------------------------- sabab
def _reason(*, minutes: int, need: int, linked: bool, over: bool,
            room_alive: bool, proof: str, covered: int = 0, buckets: int = 0,
            taught: bool = False, dead_room: bool = False,
            signin: bool = False, evidence: dict | None = None) -> tuple[str, str]:
    """(qaror, sabab) — "nega" savoliga aynan javob."""
    evidence = evidence or {}
    if not linked:
        return "unlinked", ("iMentor hisobi topilmagan: HEMIS'dagi Xodim ID bo'yicha hisob yo'q, "
                            "shuning uchun bu dars baholanmaydi.")
    if not over:
        return "pending", "Dars hali tugamagan — yakuniy xulosa berilmaydi."
    if proof:
        return "proved", proof
    if dead_room and minutes == 0:
        # Doskasi ishlamayotgani ko'rinib turgan xona. Bu texnik muammo,
        # shuning uchun dars foizga qo'shilmaydi — lekin ISTISNO
        # KO'RINADIGAN bo'lishi shart: xona sahifadagi "doska tekshirilishi
        # kerak" ro'yxatida turadi va tekshirilgandan keyin chiqib ketadi.
        return "dead_room", (f"Bu xonada oxirgi {evidence.get('days', 7)} kunda "
                             f"{evidence.get('teachers', 0)} o'qituvchi "
                             f"{evidence.get('lessons', 0)} darsda bir marta ham iMentor "
                             "ochmagan — doska ishlamayotgani ko'rinib turibdi. Dars foizga "
                             "qo'shilmaydi, xona texnik tekshiruv ro'yxatida.")
    if minutes >= need:
        return "full", f"Darsning asosiy qismi iMentor'da o'tilgan: {minutes} daqiqa (talab {need})."
    if taught and buckets:
        # Qoplama: sof vaqt kam, lekin qaydlar butun dars davomida tarqalgan —
        # ma'ruzani slayd bilan o'tgan o'qituvchi aynan shunday ko'rinadi.
        return "full", (f"Dars davomida uzluksiz ishlangan: {round(100 * covered / buckets)}% "
                        f"vaqtda qayd bor, sof ish {minutes} daqiqa. Ma'ruzada sichqonchaga "
                        f"tegilmagan daqiqalar sanalmaydi, shuning uchun qoplama bo'yicha "
                        f"hisoblandi.")
    if minutes > 0 or signin:
        extra = (" Xona kompyuteriga QR bilan kirgan, lekin bu darsni o'tgani emas."
                 if signin else "")
        return "short", (f"iMentor ochilgan, lekin faqat {minutes} daqiqa ishlangan "
                         f"(talab {need}). Dars iMentor'da o'tilmagan.{extra}")
    if room_alive:
        return "blamed", ("Hech qanday qayd yo'q. Shu kuni SHU XONADA boshqa o'qituvchi "
                          "darsni to'liq o'tgan — demak monitor ishlayapti, bahona yo'q.")
    return "check_room", ("Hech qanday qayd yo'q va shu kuni bu xonada HECH KIM iMentor "
                          "ochmagan — avval monitor tekshirilishi kerak, ayb o'qituvchida "
                          "bo'lmasligi mumkin.")


def _proof(ev: dict, students: int, m: dict | None = None) -> str:
    """Vaqtdan qat'i nazar darsning o'tilganini isbotlaydigan dalil.

    Faqat TALABALAR ishlagani shunday dalil bo'ladi. Xona kompyuteriga QR
    bilan kirish yoki hech kim javob bermagan jonli test bu yerda YO'Q:
    ular o'qituvchi xonada bo'lganini ko'rsatadi, darsni iMentor'da
    o'tganini emas (2026-10-09 da shu teshik 36 darsni noto'g'ri "to'liq"
    qilib qo'ygandi).
    """
    if (m or {}).get("student_proof"):
        return ("Guruh talabalari aynan shu dars vaqtida iMentor'da ishlagan — "
                "dars iMentor'da o'tilgani shubhasiz (o'qituvchining o'z hisobida "
                "qayd bo'lmasligi mumkin: doskadagi brauzer boshqa hisobda).")
    if students:
        kinds = {e.get("action") for e in (ev.get("events") or [])}
        what = "jonli test" if "live_test_opened" in kinds else "test"
        return f"Dars vaqtida {students} talaba iMentor'da {what} topshirgan — dars o'tilgan."
    return ""


# ----------------------------------------------------------------- hisobot
def day_report(db: Session, day: dt.date, *, faculty: str = "", department: str = "",
               monitor_id: str = "", teacher: str = "", groups: tuple[str, ...] = ()) -> dict:
    """Bitta kun: monitorli xonalardagi har bir dars bo'yicha alohida javob."""
    need = lr.MIN_LESSON_MINUTES * 60
    everything = lr._lessons(db, day, day, groups=groups, pending=True)
    monitored = [x for x in everything if x.monitor_id]

    measures = lr.measure_map(db, monitored)
    broken = lr.dead_room_details(db, day)
    dead = set(broken)
    seconds = {x.id: (measures.get(x.id) or {}).get("seconds", 0) for x in monitored}
    students = {x.id: (measures.get(x.id) or {}).get("students", 0) for x in monitored}
    taught = {x.id for x in monitored if x.id in measures and lr.is_taught(measures[x.id])}

    # Xona holati BUTUN kun bo'yicha, filtrdan OLDIN hisoblanadi: filtr
    # qo'yilganda "bu xonada boshqa kim ishlatgan" degan dalil yo'qolmasin.
    alive = {x.monitor_id for x in monitored if x.id in taught}
    touched = {x.monitor_id for x in monitored if seconds[x.id] > 0}

    faculties = _faculty_of_group(db)
    inventory = {m["monitor_id"]: m for m in ms.monitors()}
    now = lr.current_time()

    def faculty_of(lesson) -> str:
        names = getattr(lesson, "merged_groups", None) or ([lesson.group_name] if lesson.group_name else [])
        for g in names:
            if g in faculties:
                return faculties[g]
        return ""

    # --- filtrlar
    rows = monitored
    if faculty:
        rows = [x for x in rows if faculty_of(x) == faculty]
    if department:
        needle = ms._norm(department)
        rows = [x for x in rows if needle in ms._norm(x.department_name) or ms._norm(x.department_name) in needle]
    if monitor_id:
        rows = [x for x in rows if x.monitor_id == monitor_id]
    if teacher:
        rows = [x for x in rows if (x.teacher_username or "") == teacher]

    evidence = lesson_evidence.for_lessons(db, rows)
    owners = {x.teacher_username for x in rows if x.teacher_username}
    syllabi = _syllabi(db, owners)
    try:
        from app.services import hemis_staff
        on_leave = hemis_staff.on_leave_logins(db)
    except Exception:                                        # pragma: no cover
        on_leave = set()

    # Mavzu tartibi: o'qituvchining shu fan + guruh bo'yicha nechanchi darsi.
    order_of: dict[int, int] = {}
    seen: dict[tuple, int] = defaultdict(int)
    history = db.execute(text(
        "select id, teacher_username, subject_name, group_name, lesson_date, start_time "
        "from core_hemislesson where lesson_date <= :d and coalesce(teacher_username,'') <> '' "
        "order by lesson_date, start_time, id"
    ), {"d": day}).all()
    for lid, owner, subject, group, _d, _t in history:
        key = (owner, subject, group)
        order_of[lid] = seen[key]
        seen[key] += 1

    lessons_out: list[dict] = []
    for x in sorted(rows, key=lambda r: (str(r.start_time), r.monitor_id or "", r.teacher_name or "")):
        ev = evidence.get(x.id) or {}
        mins = seconds[x.id] // 60
        proof = _proof(ev, students[x.id], m0 := (measures.get(x.id) or {}))
        m = m0
        decision, reason = _reason(
            minutes=mins, need=lr.MIN_LESSON_MINUTES, linked=bool(x.teacher_username),
            over=lr.is_over(x, now), room_alive=x.monitor_id in alive, proof=proof,
            covered=m.get("covered", 0), buckets=m.get("buckets", 0),
            taught=bool(m) and lr.is_taught(m), dead_room=x.monitor_id in dead,
            signin=bool(m.get("signin")), evidence=broken.get(x.monitor_id or ""),
        )
        if x.teacher_username in on_leave:
            decision, reason = "on_leave", "Xodim ta'tilda/bandlikda — bu dars bo'yicha ayblanmaydi."
        mon = inventory.get(x.monitor_id or "", {})
        lessons_out.append({
            "lesson_id": x.id,
            "time": f"{str(x.start_time)[:5]}–{str(x.end_time)[:5]}",
            "para": x.para or "",
            "monitor_id": x.monitor_id,
            "room": mon.get("room_full") or x.monitor_room or "",
            "hemis_room": x.auditorium_name or "",
            "building": x.building_name or "",
            "teacher_key": x.teacher_username or "",
            "teacher_name": x.teacher_name or "",
            "department": x.department_name or "",
            "faculty": faculty_of(x),
            "subject": x.subject_name or "",
            "lesson_type": x.lesson_type or "",
            "groups": list(getattr(x, "merged_groups", None) or ([x.group_name] if x.group_name else [])),
            "minutes": mins,
            "required_minutes": lr.MIN_LESSON_MINUTES,
            "students": students[x.id],
            "decision": decision,
            "reason": reason,
            **_topic_for(x, order_of.get(x.id, 0), syllabi.get(x.teacher_username or "", [])),
            "pages": ev.get("pages") or [],
            "first_event": ev.get("first_event"),
            "last_event": ev.get("last_event"),
            "event_count": len(ev.get("events") or []),
        })

    # --- o'qituvchi kesimi: har kimning HAR BIR darsi alohida ko'rinadi
    by_teacher: dict[str, dict] = {}
    for row in lessons_out:
        key = row["teacher_key"] or f"name:{row['teacher_name']}"
        t = by_teacher.setdefault(key, {
            "teacher_key": row["teacher_key"], "teacher_name": row["teacher_name"],
            "department": row["department"], "faculty": row["faculty"],
            "lessons": [], "full": 0, "short": 0, "none": 0, "minutes": 0,
        })
        t["lessons"].append(row)
        t["minutes"] += row["minutes"]
        if row["decision"] in ("full", "proved"):
            t["full"] += 1
        elif row["decision"] == "short":
            t["short"] += 1
        elif row["decision"] in ("blamed", "check_room"):
            t["none"] += 1
    teachers = sorted(by_teacher.values(), key=lambda t: (t["full"], -t["none"], t["minutes"]))

    # --- xona kesimi
    by_room: dict[str, dict] = {}
    for row in lessons_out:
        mid = row["monitor_id"] or "—"
        r = by_room.setdefault(mid, {
            "monitor_id": mid, "room": row["room"],
            "department": (inventory.get(mid, {}) or {}).get("department", ""),
            "lessons": 0, "full": 0, "minutes": 0,
        })
        r["lessons"] += 1
        r["minutes"] += row["minutes"]
        r["full"] += 1 if row["decision"] in ("full", "proved") else 0
    for mid, r in by_room.items():
        r["state"] = ("alive" if mid in alive else "touched" if mid in touched
                      else "dead" if mid in dead else "quiet")
    rooms = sorted(by_room.values(), key=lambda r: (r["state"] != "quiet", -r["lessons"]))

    counted = [r for r in lessons_out
               if r["decision"] not in ("pending", "unlinked", "on_leave", "dead_room")]
    full = sum(1 for r in counted if r["decision"] in ("full", "proved"))
    return {
        "day": day.isoformat(),
        "now": now.strftime("%H:%M"),
        "required_minutes": lr.MIN_LESSON_MINUTES,
        "headline": {
            "lessons": len(counted),
            "full": full,
            "percent": round(100 * full / len(counted)) if counted else None,
            "short": sum(1 for r in counted if r["decision"] == "short"),
            "blamed": sum(1 for r in counted if r["decision"] == "blamed"),
            "check_room": sum(1 for r in counted if r["decision"] == "check_room"),
            "pending": sum(1 for r in lessons_out if r["decision"] == "pending"),
            "unlinked": sum(1 for r in lessons_out if r["decision"] == "unlinked"),
            "on_leave": sum(1 for r in lessons_out if r["decision"] == "on_leave"),
            "dead_room": sum(1 for r in lessons_out if r["decision"] == "dead_room"),
            "teachers": len(teachers),
            "rooms": len(rooms),
            "quiet_rooms": sum(1 for r in rooms if r["state"] == "quiet"),
            "no_syllabus": sum(1 for r in lessons_out if not r["topic"]),
        },
        "filters": {
            "faculties": sorted({faculty_of(x) for x in monitored if faculty_of(x)}),
            "departments": sorted({x.department_name for x in monitored if x.department_name}),
            "monitors": sorted(
                ({"monitor_id": m, "room": (inventory.get(m, {}) or {}).get("room_full", "")}
                 for m in {x.monitor_id for x in monitored if x.monitor_id}),
                key=lambda r: r["monitor_id"]),
            "applied": {"faculty": faculty, "department": department,
                        "monitor_id": monitor_id, "teacher": teacher},
        },
        "rooms": rooms,
        # Istisno ro'yxati OSHKORA: qaysi xona foizdan chiqarildi, qaysi
        # dalil bilan. Tekshirilib ishlatilgandan keyin ro'yxatdan chiqadi.
        "broken_rooms": [
            {**info, "room": (inventory.get(mid, {}) or {}).get("room_full", ""),
             "department": (inventory.get(mid, {}) or {}).get("department", ""),
             "today": sum(1 for r in lessons_out if r["monitor_id"] == mid)}
            for mid, info in sorted(broken.items(), key=lambda kv: -kv[1]["lessons"])
        ],
        "teachers": teachers,
        "lessons": lessons_out,
    }
