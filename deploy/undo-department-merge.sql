-- Kafedra birlashtirishni ORQAGA QAYTARADI.
--
-- Har ikkala bosqich ham eski qiymatni zaxira jadvaliga yozgan, shuning
-- uchun qaytarish uchun boshqa hech narsa kerak emas.
--
-- Ishlatish (serverda):
--     docker compose -f docker-compose.prod.yml exec -T postgres \
--       psql -U imentorfer -d imentorfer -v ON_ERROR_STOP=1 \
--       < deploy/undo-department-merge.sql
--
-- Qaytargandan keyin muammo ham qaytadi: o'qituvchilar yana o'z
-- kafedrasida fan ko'rmaydi. Faqat birlashtirish xato bo'lgani aniqlansa
-- ishlating.

BEGIN;

-- Fanlar: eng ESKI yozuvga qaytariladi (bir fan ikki marta ko'chirilgan
-- bo'lsa ham boshlang'ich holatiga qaytsin).
UPDATE core_coursesyllabus s
SET department_id = b.old_department_id
FROM (
    SELECT DISTINCT ON (syllabus_id) syllabus_id, old_department_id
    FROM dept_merge_backup
    ORDER BY syllabus_id, merged_at ASC, id ASC
) b
WHERE b.syllabus_id = s.id;

-- Xodimlar (faqat ikkinchi bosqichda ko'chirilganlar).
UPDATE core_staffprofile p
SET department_id = b.old_department_id
FROM (
    SELECT DISTINCT ON (profile_id) profile_id, old_department_id
    FROM staff_dept_merge_backup
    ORDER BY profile_id, merged_at ASC, id ASC
) b
WHERE b.profile_id = p.id;

SELECT 'qaytarilgan fanlar: ' || count(DISTINCT syllabus_id) FROM dept_merge_backup;

COMMIT;
