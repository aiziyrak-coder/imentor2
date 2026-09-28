#!/bin/sh
# cam.fermi.uz xodimlari JSHSHIRini iMentor hisoblariga bog'lash (JSHSHIR bilan kirish uchun).
# cam.fermi.uz bazasidan FAQAT O'QILADI, parollarga tegilmaydi. Cron har soatda, yuz sinxronidan keyin:
#   27 * * * * /home/imentor/deploy/face/pinfl-sync.sh >> /home/imentor/backups/pinfl-sync.log 2>&1
set -eu
CAM_DB=camera-api-db-1
IMENTOR_BACKEND=imentor-backend_fastapi-1
U=$(docker exec "$CAM_DB" printenv POSTGRES_USER)
D=$(docker exec "$CAM_DB" printenv POSTGRES_DB)
TMP=$(mktemp)
chmod 600 "$TMP"
trap 'rm -f "$TMP"' EXIT
docker exec "$CAM_DB" psql -U "$U" -d "$D" -v ON_ERROR_STOP=1 -At -F "$(printf '\t')" -c "
  select s.id,
         replace(replace(s.full_name, E'\t', ' '), E'\n', ' '),
         replace(replace(coalesce(s.group_or_position, ''), E'\t', ' '), E'\n', ' '),
         s.pinfl
  from students_staff s
  where s.type = 'xodim' and s.pinfl ~ '^[0-9]{14}\$'" > "$TMP"
printf '%s ' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker exec -i "$IMENTOR_BACKEND" python /app/scripts/sync_staff_pinfl.py "$@" < "$TMP"
