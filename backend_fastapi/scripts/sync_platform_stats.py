#!/usr/bin/env python
"""Boshqa platformalar raqamlarini `core_platformstat` ga yozish.

Kirish (stdin): har qatorda TAB bilan ajratilgan `kalit, nom, json, izoh`.
`deploy/platforms/platform-stats.sh` shu formatda uzatadi.

Sinov rejimi (odatiy) hech narsa yozmaydi; yozish uchun `--apply`.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.db import SessionLocal  # noqa: E402
from app.models.platform_stat import PlatformStat  # noqa: E402


def main() -> int:
    dry_run = "--apply" not in sys.argv
    rows = []
    for line in sys.stdin:
        parts = line.rstrip("\n").split("\t")
        if not parts or not parts[0].strip():
            continue
        parts += [""] * (4 - len(parts))
        key, label, raw, note = (p.strip() for p in parts[:4])
        payload, ok = {}, False
        if raw:
            try:
                payload = json.loads(raw)
                ok = isinstance(payload, dict)
            except ValueError:
                note = note or "javobni o'qib bo'lmadi"
        if not ok and not note:
            note = "ma'lumot kelmadi"
        rows.append({"platform": key[:32], "label": label[:128], "payload": payload,
                     "ok": ok, "note": note[:255]})

    if not rows:
        print("qator kelmadi — hech narsa qilinmadi")
        return 1

    now = dt.datetime.now(dt.timezone.utc)
    with SessionLocal() as db:
        for r in rows:
            mark = "OK  " if r["ok"] else "XATO"
            extra = ", ".join(f"{k}={v}" for k, v in list(r["payload"].items())[:4])
            print("   %s %-8s %s" % (mark, r["platform"], extra or r["note"]))
            if dry_run:
                continue
            rec = db.get(PlatformStat, r["platform"])
            if rec is None:
                rec = PlatformStat(platform=r["platform"])
                db.add(rec)
            # Yig'ib bo'lmagan platformaning ESKI raqamlari saqlanadi, lekin
            # `ok=False` bo'ladi: sahifa uni "eskirgan" deb ko'rsatadi.
            if r["ok"]:
                rec.payload = r["payload"]
            rec.label, rec.ok, rec.note, rec.collected_at = r["label"], r["ok"], r["note"], now
        if not dry_run:
            db.commit()

    print("%s: %d platforma" % ("SINOV" if dry_run else "YOZILDI", len(rows)))
    if dry_run:
        print("(yozish uchun: --apply)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
