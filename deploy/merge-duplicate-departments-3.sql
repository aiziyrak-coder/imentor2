-- Nusxa kafedralarni birlashtirish — uchinchi bosqich (2026-09-24).
--
--   86 "Endokrinologiya gematologiya va ftizatriya"     -> 4  "Endokrinologiya,gemotologiya va ftiziatriya sillabus"
--        0 fan, 1 xodim                                       14 fan, 34 xodim
--   92 "Mikrobiologiya, Virusalogiya va immunologiya"  -> 14 "Mikrobiologiya,virusologiya,immunologiya"
--        1 fan (TPI 3-kurs 5-semestr Mikrobiologiya), 1 xodim  12 fan, 18 xodim
--
-- Nusxada xodim yolg'iz qoladi: kafedra kutubxonasi (darslik, protokol) va
-- hamkasblar fanlari unga ko'rinmaydi. Asl kafedraga o'tkaziladi.
--
-- Xodimning matnli `department` maydoni ham asl nomga keltiriladi (hisobotlarda
-- ikki xil nom chiqmasin); eski matn zaxiraga yoziladi.
--
-- TEGILMAYDI: bo'sh nusxalar (87-101 va h.k.) — ular o'qituvchi ro'yxatiga
-- chiqmaydi (faqat fanli kafedralar ko'rsatiladi), `is_active` esa tashqi API
-- (fermi.uz) uchun kerak. 99 "Terapiya yo'nalishidagi fanlar" — aralash, qo'lda.
--
-- Hech narsa o'chirilmaydi. Orqaga qaytarish: deploy/undo-department-merge.sql
-- (id'lar) + pastdagi staff_dept_text_backup (matn).

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

CREATE TABLE IF NOT EXISTS staff_dept_text_backup (
    id          bigserial PRIMARY KEY,
    profile_id  integer     NOT NULL,
    old_text    varchar(255) NOT NULL,
    merged_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TEMP TABLE dept_map3 (from_id integer PRIMARY KEY, to_id integer NOT NULL) ON COMMIT DROP;

INSERT INTO dept_map3 (from_id, to_id) VALUES
    (86, 4),
    (92, 14);

-- Manbada darslik bo'lsa — u nusxa emas: tegilmaydi.
DELETE FROM dept_map3 m
WHERE EXISTS (SELECT 1 FROM core_bookchunk c WHERE c.department_id = m.from_id)
   OR EXISTS (SELECT 1 FROM core_subjectbook b WHERE b.department_id = m.from_id);

-- Maqsad kafedrada xodimlar bo'lishi kerak.
DELETE FROM dept_map3 m
WHERE NOT EXISTS (SELECT 1 FROM core_staffprofile p WHERE p.department_id = m.to_id);

INSERT INTO dept_merge_backup (syllabus_id, old_department_id, new_department_id)
SELECT s.id, s.department_id, m.to_id
FROM core_coursesyllabus s JOIN dept_map3 m ON m.from_id = s.department_id;

UPDATE core_coursesyllabus s SET department_id = m.to_id
FROM dept_map3 m WHERE s.department_id = m.from_id;

INSERT INTO staff_dept_merge_backup (profile_id, old_department_id, new_department_id)
SELECT p.id, p.department_id, m.to_id
FROM core_staffprofile p JOIN dept_map3 m ON m.from_id = p.department_id;

INSERT INTO staff_dept_text_backup (profile_id, old_text)
SELECT p.id, p.department
FROM core_staffprofile p JOIN dept_map3 m ON m.from_id = p.department_id;

UPDATE core_staffprofile p SET department_id = m.to_id, department = d.name
FROM dept_map3 m JOIN core_academicdepartment d ON d.id = m.to_id
WHERE p.department_id = m.from_id;

-- Natija: manbalar bo'sh bo'lishi kerak.
SELECT m.from_id,
       (SELECT count(*) FROM core_coursesyllabus s WHERE s.department_id = m.from_id) AS syllabi_left,
       (SELECT count(*) FROM core_staffprofile p WHERE p.department_id = m.from_id) AS staff_left
FROM (VALUES (86), (92)) AS m(from_id);

COMMIT;
