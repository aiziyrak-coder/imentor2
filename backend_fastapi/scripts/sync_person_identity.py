#!/usr/bin/env python
"""cam.fermi.uz shaxs ro'yxatini (JSHSHIR + pasport) iMentor'ga ko'chirish.

Kirish (stdin): har qatorda TAB bilan ajratilgan
`id, kind, full_name, pinfl, passport_series, passport_number, hemis_id`.
Serverdagi `deploy/face/identity-sync.sh` cam.fermi.uz bazasidan FAQAT O'QIB
shu formatda uzatadi.

JSHSHIR va pasport HEMIS'da yo'q — tekshirilgan; yagona manba shu.

Sinov rejimi (odatiy) hech narsa yozmaydi; yozish uchun `--apply`.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.db import SessionLocal  # noqa: E402
from app.services import person_identity as pi  # noqa: E402

COLUMNS = ("id", "kind", "full_name", "pinfl", "passport_series", "passport_number", "hemis_id")


def main() -> int:
    dry_run = "--apply" not in sys.argv
    rows = []
    for line in sys.stdin:
        line = line.rstrip("\n")
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) < len(COLUMNS):
            parts += [""] * (len(COLUMNS) - len(parts))
        rows.append(dict(zip(COLUMNS, parts[: len(COLUMNS)])))

    if not rows:
        print("qator kelmadi — hech narsa qilinmadi")
        return 1

    with SessionLocal() as db:
        out = pi.sync(db, rows, dry_run=dry_run)
        cover = pi.coverage(db) if not dry_run else {}

    print(
        "{mode}: kelgan {received}, yangi {created}, yangilandi {updated}, "
        "nofaol {deactivated}; JSHSHIRsiz {no_pinfl}, pasporti tanilmadi "
        "{bad_passport}, tashlandi {skipped}".format(
            mode="SINOV" if dry_run else "YOZILDI", **out
        )
    )
    for kind, c in sorted(cover.items()):
        print("  {}: {} ta — JSHSHIR {}, pasport {}".format(
            kind, c["jami"], c["pinfl"], c["passport"]))
    if dry_run:
        print("(yozish uchun: --apply)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
