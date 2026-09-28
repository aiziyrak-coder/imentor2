"""cam.fermi.uz tasdiqlangan xodim yuzlarini iMentor'ga nusxalash.

Kirish (stdin), TAB bilan ajratilgan qatorlar:
  * yuz: `id, full_name, position, embedding[, type, passport]` (type: xodim|talaba);
  * `S, id, name, group` — OnlineTest talabasi (talaba yuzini hisobga bog'lash uchun).
Serverdagi `deploy/face/face-sync.sh` cam.fermi.uz va OnlineTest bazalaridan FAQAT O'QIB uzatadi.

Himoya: kelgan yuzlar soni hozirgi faol yuzlarning yarmidan kam bo'lsa
(masalan, cam.fermi.uz bazasi javob bermay bo'sh chiqish berdi) hech narsa
o'zgartirilmaydi — aks holda hamma o'qituvchi yuz orqali kira olmay qolardi.
`--force` bu himoyani o'chiradi.
"""

from __future__ import annotations

import sys

sys.path.insert(0, "/app")

from sqlalchemy import func, select  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402
from app.models.face_template import FaceTemplate  # noqa: E402
from app.services import face_login as fl  # noqa: E402


def main() -> int:
    force = "--force" in sys.argv
    dry_run = "--dry-run" in sys.argv
    rows = []
    students: list[dict] = []
    for line in sys.stdin.read().splitlines():
        parts = line.split("\t")
        if parts[0] == "S" and len(parts) == 4:
            students.append({"id": parts[1], "name": parts[2], "group": parts[3]})
        elif len(parts) == 4:
            rows.append({"id": parts[0], "full_name": parts[1], "position": parts[2], "embedding": parts[3]})
        elif len(parts) == 6:
            rows.append({
                "id": parts[0], "full_name": parts[1], "position": parts[2], "embedding": parts[3],
                "type": parts[4], "passport": parts[5],
            })
    db = SessionLocal()
    try:
        active = db.execute(select(func.count(FaceTemplate.id)).where(FaceTemplate.is_active.is_(True))).scalar() or 0
        if not force and active and len(rows) < active * 0.5:
            print(f"TO'XTATILDI: {len(rows)} ta yuz keldi, bazada {active} ta faol. Hech narsa o'zgarmadi.")
            return 2
        # OnlineTest ro'yxati bo'sh kelsa (baza javob bermadi) talaba bog'lanishlariga tegilmaydi.
        result = fl.sync_templates(db, rows, dry_run=dry_run, students=students or None)
        if dry_run:
            print(f"SINOV (hech narsa saqlanmadi): bog'lanadi={result.auto_linked}")
            for full_name, owner in result.links:
                print(f"  {full_name} -> {owner}")
            return 0
        linked = db.execute(
            select(func.count(FaceTemplate.id)).where(FaceTemplate.is_active.is_(True), FaceTemplate.owner_key != "")
        ).scalar()
        print(
            f"OK keldi={len(rows)} yangi={result.created} yangilandi={result.updated} "
            f"o'chdi={result.deactivated} avto_bog'landi={result.auto_linked} "
            f"yaroqsiz={result.skipped_bad} jami_bog'langan={linked}"
        )
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
