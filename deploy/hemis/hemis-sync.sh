#!/usr/bin/env bash
# HEMIS'dan kunlik sinxron: dars jadvali, talabalar kontingenti, kafedra bog'lanishi (2026-09-25).
#
# Crontab (admin_root), har kuni ertalab 6:47 da:
#   47 6 * * * /home/imentor/deploy/hemis/hemis-sync.sh >> /home/imentor/backups/hemis-sync.log 2>&1
#
# HEMIS'dan FAQAT o'qiydi. Kafedralar Excel'i bilan yonma-yon turadi:
# sinxron faqat o'z yozuvlarini (source='hemis') almashtiradi.
#
# Argumentlar jadval sinxroniga uzatiladi (masalan --dry-run --weeks 2).
set -eu

BACKEND=imentor-backend_fastapi-1

run() {
  printf '%s %s: ' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1"
  shift
  docker exec "$BACKEND" python "$@" | tr '\n' ' ' | sed 's/  */ /g'
  echo
}

run jadval /app/scripts/sync_hemis_schedule.py "$@"
run darslar /app/scripts/sync_hemis_lessons.py "$@"
run kontingent /app/scripts/sync_hemis_students.py "$@"
run kafedralar /app/scripts/sync_hemis_departments.py "$@"
# Profil: bo'sh kafedra/lavozim va ish holati (ta'tildagilar hisobotda ayblanmaydi).
run xodimlar /app/scripts/sync_hemis_staff.py "$@"
