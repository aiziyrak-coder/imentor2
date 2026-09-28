-- Nusxa kafedralarni birlashtirish — ikkinchi bosqich.
--
-- Birinchi bosqich manba kafedrada BITTA ham xodim bo'lmasligini talab
-- qilgan edi. Quyidagi ikkitasida bittadan adashgan xodim bor, shuning
-- uchun ular chetda qolgan — lekin ikkalasi ham aniq nusxa:
--
--   90 "Ichki kasallilar propedevtikasi"      -> 10 "Ichki kasalliklar propedevtikasi kafedrasi"
--        5 fan, 1 xodim, 0 darslik                 10 xodim, 3 781 parcha
--        Fanlari: "Ichki kasallikalr propedevtikasi 5-s DI/PI, 6-s DI" —
--        nomining o'zi kafedrani aytib turibdi.
--
--   91 "Lotin tilli, pedagogika va psixalogiya" -> 13 "Lotin tili"
--       16 fan, 1 xodim, 0 darslik                 20 xodim
--        Fanlari: lotin tili, tibbiy terminologiya, pedagogika va
--        psixologiya — 13-kafedraning to'liq nomi aynan shu.
--
-- Fanlar bilan birga o'sha ikki xodim ham asl kafedraga o'tkaziladi:
-- nusxa yozuv bo'sh qolishi kerak, aks holda ular fansiz kafedrada
-- yolg'iz qolib, yana o'sha boshi berk ko'chaga tushadi.
--
-- TEGILMAYDI:
--   99 "Terapiya yo'nalishidagi fanlar" — nusxa emas, aralash to'plam
--      (ichki kasalliklar, pediatriya neyroxirurgiyasi, stomatologiya
--      xirurgiyasi). 7 ta fani qo'lda taqsimlanishi kerak.
--   35 "Terapiya UASH" — katalogda unga tegishli fan umuman yo'q.
--
-- Hech narsa o'chirilmaydi; eski qiymatlar zaxira jadvallariga yoziladi.

BEGIN;

CREATE TABLE IF NOT EXISTS dept_merge_backup (
    id                 bigserial PRIMARY KEY,
    syllabus_id        integer     NOT NULL,
    old_department_id  integer     NOT NULL,
    new_department_id  integer     NOT NULL,
    merged_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_dept_merge_backup (
    id                 bigserial PRIMARY KEY,
    profile_id         integer     NOT NULL,
    old_department_id  integer     NOT NULL,
    new_department_id  integer     NOT NULL,
    merged_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TEMP TABLE dept_map2 (from_id integer PRIMARY KEY, to_id integer NOT NULL) ON COMMIT DROP;

INSERT INTO dept_map2 (from_id, to_id) VALUES
    (90, 10),
    (91, 13);

-- Manbada darslik bo'lsa — u nusxa emas, haqiqiy kafedra: tegilmaydi.
DELETE FROM dept_map2 m
WHERE EXISTS (SELECT 1 FROM core_bookchunk c WHERE c.department_id = m.from_id);

-- Maqsad kafedra mavjud va xodimlari bor bo'lishi kerak.
DELETE FROM dept_map2 m
WHERE NOT EXISTS (
    SELECT 1 FROM core_staffprofile p WHERE p.department_id = m.to_id
);

INSERT INTO dept_merge_backup (syllabus_id, old_department_id, new_department_id)
SELECT s.id, s.department_id, m.to_id
FROM core_coursesyllabus s
JOIN dept_map2 m ON m.from_id = s.department_id;

UPDATE core_coursesyllabus s
SET department_id = m.to_id
FROM dept_map2 m
WHERE s.department_id = m.from_id;

INSERT INTO staff_dept_merge_backup (profile_id, old_department_id, new_department_id)
SELECT p.id, p.department_id, m.to_id
FROM core_staffprofile p
JOIN dept_map2 m ON m.from_id = p.department_id;

UPDATE core_staffprofile p
SET department_id = m.to_id
FROM dept_map2 m
WHERE p.department_id = m.from_id;

COMMIT;
