-- Nusxa kafedralarni birlashtiradi — YAGONA, TO'LIQ skript.
--
-- Ishlatish (serverda, /home/imentor ichida):
--     docker compose -f docker-compose.prod.yml exec -T postgres \
--       psql -U imentorfer -d imentorfer -v ON_ERROR_STOP=1 < deploy/fix-departments.sql
--
-- Oxirida natija jadvali chiqadi — hech narsani alohida tekshirish shart emas.
--
--
-- MUAMMO
--   Sillabuslar yuklanganda mavjud kafedra bilan solishtirilmasdan yangi
--   yozuv ochilgan. Bitta haqiqiy kafedra bazada ikki marta turibdi:
--   fanlar bittasida, xodimlar va darsliklar ikkinchisida. 638 xodimdan
--   349 tasi o'z kafedrasida bitta ham fan ko'rmagan, 351 ta fan esa
--   darsligi nol bo'lgan kafedraga bog'langan (RAG qidiradigan joyi yo'q).
--
-- NIMA QILADI
--   Faqat `department_id` ni ko'chiradi. Fan, mavzu, xodim, darslik va
--   tanlovlarning o'zi tegilmaydi; hech narsa o'chirilmaydi. Nusxa kafedra
--   yozuvlari ham qoladi, shunchaki bo'sh bo'lib.
--
-- ORQAGA QAYTARISH
--   Eski qiymatlar `dept_merge_backup` va `staff_dept_merge_backup`
--   jadvallariga yoziladi. Qaytarish kerak bo'lsa — VA FAQAT SHUNDA —
--   `deploy/undo-department-merge.sql` ishlatiladi. Uni shu skript bilan
--   ketma-ket ishga tushirmang: ikkinchisi birinchisining ishini bekor
--   qiladi.
--
-- TEGILMAYDI
--   99 "Terapiya yo'nalishidagi fanlar" — nusxa emas, aralash to'plam
--      (ichki kasalliklar, pediatriya neyroxirurgiyasi, stomatologiya
--      xirurgiyasi). 7 ta fani odam qo'li bilan taqsimlanishi kerak.
--   35 "Terapiya UASH" — katalogda unga tegishli fan umuman yo'q.

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

CREATE TEMP TABLE dept_map (from_id integer PRIMARY KEY, to_id integer NOT NULL) ON COMMIT DROP;

INSERT INTO dept_map (from_id, to_id) VALUES
    ( 98, 23),  -- Stomatologiya va otorinoloringologiya    -> ...otorinolaringologiya
    (101, 28),  -- Xalq tabobati va farmakologiya kafedrasi -> Xalq tabobati va Farmakologiya
    ( 87,  5),  -- Epidemiologiya ... hamshiralik ishi (vergul farqi)
    ( 94, 18),  -- O'zbek va xorijiy tillar kafedrasi       -> O'zbek va xorijiy tillar
    ( 93, 15),  -- Nevrologiya va Psixiatriya               -> Nevrologiya va psixatriya
    ( 95, 17),  -- Ovqatlanish, Bolalar va o'smirlar gigienasi
    (100, 25),  -- Travmatologiya va ortapediya             -> ...ortopediya
    ( 97, 22),  -- Preventive tibbiyot...                   -> Preventiv
    ( 86,  4),  -- Endokrinologiya gematologiya va ftizatriya
    ( 96, 20),  -- Pediatriya 1                             -> Pediatriya
    ( 88,  6),  -- Fakultativ va gospital jarrohlik         -> Fakultet va gospital jarrohlik
    ( 89,  8),  -- GISTOLOGIYA BIOLOGIYA                    -> Gistologiya va biologiya
    ( 92, 14),  -- Mikrobiologiya, Virusalogiya             -> Mikrobiologiya,virusologiya,immunologiya
    ( 90, 10),  -- Ichki kasallilar propedevtikasi          -> Ichki kasalliklar propedevtikasi kafedrasi
    ( 91, 13);  -- Lotin tilli, pedagogika va psixalogiya   -> Lotin tili

-- Manbada darslik bo'lsa — u nusxa emas, haqiqiy kafedra: tegilmaydi.
DELETE FROM dept_map m
WHERE EXISTS (SELECT 1 FROM core_bookchunk c WHERE c.department_id = m.from_id);

-- Maqsad kafedra mavjud bo'lishi shart.
DELETE FROM dept_map m
WHERE NOT EXISTS (SELECT 1 FROM core_academicdepartment d WHERE d.id = m.to_id);

-- Fanlar.
INSERT INTO dept_merge_backup (syllabus_id, old_department_id, new_department_id)
SELECT s.id, s.department_id, m.to_id
FROM core_coursesyllabus s
JOIN dept_map m ON m.from_id = s.department_id;

UPDATE core_coursesyllabus s
SET department_id = m.to_id
FROM dept_map m
WHERE s.department_id = m.from_id;

-- Nusxa yozuvda qolib ketgan yakka xodimlar ham asl kafedraga o'tadi;
-- aks holda ular bo'sh kafedrada yolg'iz qolib, yana fansiz bo'ladi.
INSERT INTO staff_dept_merge_backup (profile_id, old_department_id, new_department_id)
SELECT p.id, p.department_id, m.to_id
FROM core_staffprofile p
JOIN dept_map m ON m.from_id = p.department_id;

UPDATE core_staffprofile p
SET department_id = m.to_id
FROM dept_map m
WHERE p.department_id = m.from_id;

COMMIT;

-- ─────────────────────────── NATIJA ───────────────────────────
SELECT 'fani yoq xodimlar   (349 -> 22 kutilgan)' AS korsatkich,
       count(*)::text AS qiymat
FROM core_staffprofile p
WHERE p.department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM core_coursesyllabus s
    WHERE s.department_id = p.department_id AND s.is_active
      AND jsonb_array_length(coalesce(s.topics, '[]'::jsonb)) > 0)
UNION ALL
SELECT 'darsligi yoq fanlar (351 -> 161 kutilgan)',
       count(*)::text
FROM core_coursesyllabus s
WHERE s.is_active AND NOT EXISTS (
    SELECT 1 FROM core_bookchunk c WHERE c.department_id = s.department_id)
UNION ALL
SELECT 'jami faol fan       (479 ozgarmasligi kerak)',
       count(*)::text FROM core_coursesyllabus WHERE is_active
UNION ALL
SELECT 'jami xodim profili  (620 ozgarmasligi kerak)',
       count(*)::text FROM core_staffprofile;
