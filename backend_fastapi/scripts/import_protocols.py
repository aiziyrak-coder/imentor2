"""Kafedra protokollarini (klinik protokol, SanPin, SSV buyrug'i) kutubxonaga yuklash.

    python scripts/import_protocols.py --dir /tmp/protokollar --department 5 --source "Yuqumli kasalliklar" --dry-run
    python scripts/import_protocols.py --dir /tmp/protokollar --department 5 --source "Yuqumli kasalliklar"

PDF, .docx va eski .doc o'qiladi. Har hujjat `core_subjectbook` da `kind='protocol'`
bo'lib saqlanadi va parchalari embedding bilan indekslanadi. Idempotent: shu kafedrada
xuddi shu nomli protokol bo'lsa, qayta yuklanmaydi.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, "/app")

from app.core.config import get_settings  # noqa: E402
from app.core.db import SessionLocal  # noqa: E402
from app.services import malaka_service as mk  # noqa: E402
from app.services import protocol_library as pl  # noqa: E402

SUPPORTED = (".pdf", ".docx", ".doc", ".txt")


def read_text(path: Path) -> str:
    """PDF/.docx/.doc/.txt — malaka test importidagi o'sha ajratgichlar."""
    return mk.extract_text(path.name, path.read_bytes())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--department", type=int, required=True)
    ap.add_argument("--source", default="")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    api_key = (get_settings().openai_api_key or "").strip()
    if not api_key and not args.dry_run:
        raise SystemExit("OPENAI_API_KEY yo'q — embedding olinmaydi")

    root = Path(args.dir)
    files = sorted(p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in SUPPORTED)
    if args.limit:
        files = files[: args.limit]
    print(f"{len(files)} ta fayl topildi: {root}")

    db = SessionLocal()
    try:
        have = pl.existing_titles(db, args.department)
        added = skipped = failed = chunks_total = 0
        for path in files:
            # Nom: papka + fayl (papka mavzuni bildiradi: "bezgak/121-buyruq.pdf").
            rel = path.relative_to(root)
            title = " / ".join(rel.parts)[:512]
            if title.strip().lower() in have:
                skipped += 1
                continue
            try:
                text = read_text(path)
            except Exception as exc:  # noqa: BLE001
                print(f"  XATO (o'qib bo'lmadi): {title} — {exc}")
                failed += 1
                continue
            pieces = pl.split_chunks(text)
            if not pieces:
                print(f"  BO'SH (matn chiqmadi): {title}")
                failed += 1
                continue
            if args.dry_run:
                print(f"  + {title}: {len(pieces)} parcha, {len(text)} belgi")
                added += 1
                chunks_total += len(pieces)
                continue
            book, n = pl.add_protocol(
                db, department_id=args.department, title=title, text=text,
                source_archive=args.source, file_name=path.name, api_key=api_key,
            )
            db.commit()
            have.add(title.strip().lower())
            added += 1
            chunks_total += n
            print(f"  + #{book.id} {title}: {n} parcha")
        print(f"\nyangi={added} o'tkazib yuborildi={skipped} xato={failed} parcha={chunks_total}")
        if args.dry_run:
            db.rollback()
            print("SINOV (saqlanmadi)")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
