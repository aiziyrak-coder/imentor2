#!/bin/sh
# cam.fermi.uz'da yuzi tasdiqlangan xodim VA talabalarni iMentor'ga nusxalash (yuz orqali kirish uchun).
# cam.fermi.uz va OnlineTest bazalaridan FAQAT O'QILADI. Cron har soatda ishga tushiradi:
#   17 * * * * /home/imentor/deploy/face/face-sync.sh >> /home/imentor/backups/face-sync.log 2>&1
# Talaba yuzi OnlineTest'dagi hisobiga (ism-familiya bo'yicha yagona moslik) yoki pasporti bo'yicha
# malaka tinglovchisiga bog'lanadi. OnlineTest javob bermasa, talaba bog'lanishlari o'zgarmaydi.
set -eu
CAM_DB=camera-api-db-1
OT_DB=onlinetest-db-1
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
         s.biometric_embedding,
         s.type,
         replace(coalesce(s.passport_series, '') || coalesce(s.passport_number, ''), E'\t', '')
  from students_staff s
  where s.type in ('xodim', 'talaba') and s.biometrics_status = 'tasdiqlangan' and s.biometric_embedding is not null" > "$TMP"
OU=$(docker exec "$OT_DB" printenv POSTGRES_USER 2>/dev/null || true)
OD=$(docker exec "$OT_DB" printenv POSTGRES_DB 2>/dev/null || true)
if [ -n "$OU" ] && [ -n "$OD" ]; then
  docker exec "$OT_DB" psql -U "$OU" -d "$OD" -At -F "$(printf '\t')" -c "
    select 'S', u.id,
           replace(replace(u.name, E'\t', ' '), E'\n', ' '),
           replace(coalesce(g.name, ''), E'\t', ' ')
    from users u left join groups g on g.id = u.group_id
    where u.role = 'student'" >> "$TMP" || echo "OnlineTest ro'yxati olinmadi — talaba bog'lanishlari o'zgarmaydi" >&2
fi
printf '%s ' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker exec -i "$IMENTOR_BACKEND" python /app/scripts/sync_face_templates.py "$@" < "$TMP"
