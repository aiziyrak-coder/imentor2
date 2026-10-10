"""Monitor xonalari kesimi — bahonani xonaning O'ZIDAN tekshirish (2026-09-25).

Hisobotga eng ko'p keladigan ikki e'tiroz:

  «Menda u kuni dars yo'q edi»  → har qator HEMIS yozuvining o'zi: dars id,
      sana, para, soat, fan, guruh, xona. Jadval HEMIS'dan olinadi, qo'lda
      kiritilmaydi, ya'ni bahs HEMIS bilan bo'ladi, hisobot bilan emas.

  «U xonada monitor yo'q / ishlamaydi» → shu modul javob beradi. Har monitor
      xonasi bo'yicha: nechta dars bo'lgan, nechtasida iMentor ochilgan, necha
      xil o'qituvchi kirgan. Agar bitta xonada o'nlab dars va bir necha
      o'qituvchi bo'lib, BIRORTASI ham ochmagan bo'lsa — bu o'qituvchilarning
      emas, xonaning muammosi: xona «tekshirish kerak» deb belgilanadi va
      undagi darslar uchun hech kim aybdor qilinmaydi.

      Teskarisi ham shunday: xonada kimdir ishlatgan bo'lsa, monitor ISHLAYAPTI
      degani. O'sha xonadagi boshqa o'qituvchi uchun bahona qolmaydi.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Iterable

# Xona "tekshirish kerak" deyilishi uchun shundan kam bo'lmagan dalil kerak:
# bitta o'qituvchining bir-ikki darsi bilan monitor buzuq deb bo'lmaydi.
SUSPECT_LESSONS = 8
SUSPECT_TEACHERS = 3

#: Xona holati.
#: ok      — kamida bitta darsda ishlatilgan, ya'ni monitor ishlayotgani isbot.
#: suspect — ko'p dars, bir necha o'qituvchi, birorta ishlatish yo'q → texnik tekshiruv.
#: quiet   — dars kam, ishlatish yo'q → hali xulosa qilib bo'lmaydi.
STATUS_LABEL = {
    "ok": "faollik qaydi bor; qurilma holati tasdiqlanmagan",
    "suspect": "tekshirish kerak",
    "quiet": "ma'lumot kam",
}


def _blank(monitor_id: str) -> dict:
    return {
        "monitor_id": monitor_id,
        "room": "",
        "department": "",
        "hemis_rooms": set(),
        "buildings": set(),
        "lessons": 0,
        "used": 0,
        "active_lesson_ids": set(),
        "teachers": set(),
        "used_teachers": set(),
        "departments": set(),
        "last_used": None,
    }


def room_stats(lessons: Iterable, used: dict[int, tuple[bool, int]]) -> dict[str, dict]:
    """`monitor_id` → shu xonadagi darslar va ularning holati.

    Kirish ma'lumoti hisobot bilan BIR XIL: o'sha darslar, o'sha "ishlatildi"
    o'lchovi. Shuning uchun xona holati va o'qituvchi bahosi bir-biriga qarama-qarshi
    chiqa olmaydi.
    """
    out: dict[str, dict] = {}
    for lesson in lessons:
        if not lesson.monitor_id:
            continue
        row = out.setdefault(lesson.monitor_id, _blank(lesson.monitor_id))
        row["room"] = row["room"] or getattr(lesson, "monitor_room", "") or lesson.auditorium_name
        row["department"] = row["department"] or getattr(lesson, "monitor_department", "")
        if lesson.auditorium_name:
            row["hemis_rooms"].add(lesson.auditorium_name)
        if lesson.building_name:
            row["buildings"].add(lesson.building_name)
        if lesson.department_name:
            row["departments"].add(lesson.department_name)
        row["lessons"] += 1
        if lesson.teacher_username:
            row["teachers"].add(lesson.teacher_username)
        if lesson.id in used:
            row["used"] += 1
            row["active_lesson_ids"].add(lesson.id)
            if lesson.teacher_username:
                row["used_teachers"].add(lesson.teacher_username)
            if row["last_used"] is None or lesson.lesson_date > row["last_used"]:
                row["last_used"] = lesson.lesson_date

    for row in out.values():
        row["status"] = _status(row)
    return out


def _status(row: dict) -> str:
    if row["used"] > 0:
        return "ok"
    if row["lessons"] >= SUSPECT_LESSONS and len(row["teachers"]) >= SUSPECT_TEACHERS:
        return "suspect"
    return "quiet"


def payload(stats: dict[str, dict]) -> list[dict]:
    """Xonalar ro'yxati — avval tekshirish kerak bo'lganlari."""
    rows = [{
        "monitor_id": r["monitor_id"],
        "room": r["room"],
        "department": r["department"],
        "hemis_rooms": sorted(r["hemis_rooms"])[:4],
        "building": sorted(r["buildings"])[0] if r["buildings"] else "",
        "lessons": r["lessons"],
        "used": r["used"],
        "percent": round(100 * r["used"] / r["lessons"]) if r["lessons"] else 0,
        "teachers": len(r["teachers"]),
        "used_teachers": len(r["used_teachers"]),
        "departments": sorted(r["departments"])[:3],
        "last_used": r["last_used"].isoformat() if r["last_used"] else None,
        "status": r["status"],
        "status_label": STATUS_LABEL[r["status"]],
        "device_health_verified": False,
    } for r in stats.values()]
    order = {"suspect": 0, "quiet": 1, "ok": 2}
    rows.sort(key=lambda r: (order[r["status"]], -r["lessons"]))
    return rows


def teacher_excuse(lessons: Iterable, stats: dict[str, dict]) -> str:
    """Room-level telemetry cannot establish an individual teacher's access."""
    return "check_room"


def summary(stats: dict[str, dict]) -> dict:
    """Xonalar bo'yicha qisqacha: nechtasi ishlayapti, nechtasi tekshirilishi kerak."""
    rows = list(stats.values())
    return {
        "rooms": len(rows),
        "ok": sum(1 for r in rows if r["status"] == "ok"),
        "suspect": sum(1 for r in rows if r["status"] == "suspect"),
        "quiet": sum(1 for r in rows if r["status"] == "quiet"),
        "suspect_lessons": sum(r["lessons"] for r in rows if r["status"] == "suspect"),
    }
