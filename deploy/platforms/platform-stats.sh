#!/bin/sh
# Institutning boshqa tizimlaridan raqamlarni yig'ish (FAQAT O'QIYDI).
#
# Har bir platforma o'z konteynerida, o'z bazasida ishlaydi. Bu skript ularga
# faqat `select` yuboradi — hech narsa yozilmaydi va hech bir xizmat qayta
# ishga tushirilmaydi. Natija iMentor bazasidagi `core_platformstat` ga
# qo'yiladi, rektor sahifasi esa o'sha yerdan o'qiydi.
#
# Cron (soatiga bir marta):
#   7 * * * * /home/imentor/deploy/platforms/platform-stats.sh --apply >> /home/imentor/backups/platform-stats.log 2>&1
set -eu

IMENTOR_BACKEND=imentor-backend_fastapi-1
TMP=$(mktemp)
chmod 600 "$TMP"
trap 'rm -f "$TMP"' EXIT

WEEK="now() - interval '7 days'"

# Bitta platformadan JSON oladi va TAB bilan ajratilgan qator chiqaradi:
#   kalit, nom, json, izoh
# Baza javob bermasa json bo'sh qoladi va izoh yoziladi: sahifada eski raqam
# yangidek ko'rinmasin.
collect() {
  key="$1"; label="$2"; container="$3"; dbname="$4"; sql="$5"
  user=$(docker exec "$container" printenv POSTGRES_USER 2>/dev/null || true)
  if [ -z "$user" ]; then
    printf '%s\t%s\t\tbaza konteyneri ishlamayapti\n' "$key" "$label"
    return
  fi
  json=$(docker exec "$container" psql -U "$user" -d "$dbname" -At -c "$sql" 2>/dev/null || true)
  if [ -n "$json" ]; then
    printf '%s\t%s\t%s\t\n' "$key" "$label" "$json"
  else
    printf '%s\t%s\t\tso‘rov bajarilmadi\n' "$key" "$label"
  fi
}

{
  collect itest "Online imtihon (iTest)" onlinetest-db-1 onlinetest "
    select json_build_object(
      'imtihonlar', (select count(*) from exams),
      'imtihon_hafta', (select count(*) from exams where start_time >= $WEEK),
      'topshirgan_hafta', (select count(*) from student_exams where completed_at >= $WEEK),
      'topshirgan_jami', (select count(*) from student_exams where status = 'Completed'),
      'ortacha_ball', (select coalesce(round(avg(score)::numeric, 1), 0) from student_exams
                       where completed_at >= $WEEK and score is not null),
      'qoidabuzarlik_hafta', (select count(*) from violations_log where timestamp >= $WEEK),
      'foydalanuvchi', (select count(*) from users),
      'oqituvchi', (select count(*) from users where role = 'teacher')
    )"

  collect icam "Kamera nazorati (iCam)" camera-api-db-1 camera_api "
    select json_build_object(
      'kamera', (select count(*) from cameras),
      -- Holat qiymati o'zbekcha: 'faol'. Boshqasi qo'shilsa ham sanalsin deb
      -- teskarisidan emas, aynan shu qiymat bo'yicha sanaladi.
      'kamera_ishlayapti', (select count(*) from cameras where status = 'faol'),
      'uzilish_ochiq', (select count(*) from camera_outages where ended_at is null),
      'davomat_hafta', (select count(*) from attendance_records where date >= current_date - 7),
      'darslar_hafta', (select count(*) from lesson_sessions where date >= current_date - 7),
      'ortacha_diqqat', (select coalesce(round(avg(attention_score)::numeric, 1), 0)
                         from lesson_sessions where date >= current_date - 7
                           and attention_score is not null),
      'oz_vaqtida', (select coalesce(round(100.0 * count(*) filter (where teacher_on_time)
                       / nullif(count(*), 0)), 0)
                     from lesson_sessions where date >= current_date - 7
                       and teacher_on_time is not null),
      'royxatda', (select count(*) from students_staff where active)
    )"

  collect ishifo "Teletibbiyot (iShifo)" ishifo-db ishifo "
    select json_build_object(
      'bemor', (select count(*) from \"Patient\"),
      'konsultatsiya', (select count(*) from \"Consultation\"),
      'konsultatsiya_hafta', (select count(*) from \"Consultation\" where \"createdAt\" >= $WEEK),
      'yakunlangan', (select count(*) from \"Consultation\" where status = 'COMPLETED'),
      'jarayonda', (select count(*) from \"Consultation\" where status = 'IN_PROGRESS'),
      'shifokor', (select count(*) from \"User\" where \"isActive\"),
      'ai_tahlil', (select count(*) from \"AiAnalysis\"),
      'ai_tahlil_hafta', (select count(*) from \"AiAnalysis\" where \"createdAt\" >= $WEEK)
    )"
} > "$TMP"

printf '%s ' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker exec -i "$IMENTOR_BACKEND" python /app/scripts/sync_platform_stats.py "$@" < "$TMP"
