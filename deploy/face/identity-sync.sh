#!/bin/sh
# cam.fermi.uz dagi JSHSHIR va pasportni iMentor'ga ko'chirish (parolsiz kirish uchun).
# cam.fermi.uz bazasidan FAQAT O'QILADI. Cron har soatda, yuz sinxronidan keyin:
#   37 * * * * /home/imentor/deploy/face/identity-sync.sh --apply >> /home/imentor/backups/identity-sync.log 2>&1
#
# JSHSHIR ham, pasport ham HEMIS'da YO'Q (tekshirilgan: talabada 62, xodimda 33
# maydon) — shuning uchun manba shu baza.
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
         s.type,
         replace(replace(s.full_name, E'\t', ' '), E'\n', ' '),
         coalesce(s.pinfl, ''),
         coalesce(s.passport_series, ''),
         coalesce(s.passport_number, ''),
         coalesce(s.hemis_id, '')
  from students_staff s
  where s.active
    and (s.pinfl ~ '^[0-9]{14}\$' or coalesce(s.passport_number, '') <> '')" > "$TMP"
printf '%s ' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker exec -i "$IMENTOR_BACKEND" python /app/scripts/sync_person_identity.py "$@" < "$TMP"
