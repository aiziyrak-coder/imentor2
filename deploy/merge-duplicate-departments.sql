-- Nusxa kafedralardagi fanlarni asl kafedraga ko'chiradi.
--
-- MUAMMO
--   Sillabuslar yuklanganda mavjud kafedra yozuvi bilan solishtirilmasdan
--   yangisi ochilgan. Natijada bitta haqiqiy kafedra bazada ikki marta
--   turibdi: fanlar bittasida, xodimlar va darsliklar ikkinchisida.
--   638 xodimdan 349 tasi shu sababli o'z kafedrasida bitta ham fan
--   ko'rmasdi, RAG esa sillabusni darsligi nol bo'lgan kafedraga bog'lardi.
--
-- NIMA QILADI
--   Faqat `core_coursesyllabus.department_id` ni ko'chiradi. Fan, mavzu,
--   xodim, darslik, tanlov — hech biri o'chirilmaydi va o'zgarmaydi.
--   Nusxa kafedra yozuvlari ham o'chirilmaydi, shunchaki bo'sh qoladi.
--
--   Har o'zgargan qator uchun eski qiymat `dept_merge_backup` jadvaliga
--   yoziladi; orqaga qaytarish uchun shu jadvalning o'zi yetarli.
--
-- MOSLIK
--   Har juftlik qo'lda tekshirilgan: manba kafedrada xodim ham, darslik
--   ham yo'q (ya'ni u faqat sillabus yuklashda paydo bo'lgan), maqsad
--   kafedrada esa ikkalasi ham bor.
--
--   `99 Terapiya yo'nalishidagi fanlar` ATAYLAB tashlab ketilgan: uning
--   ichida ichki kasalliklar ham, pediatriya ham, stomatologiya ham bor —
--   bu bitta kafedra emas, aralash to'plam. Uning 7 ta fani qo'lda
--   taqsimlanishi kerak.

BEGIN;

CREATE TABLE IF NOT EXISTS dept_merge_backup (
    id                 bigserial PRIMARY KEY,
    syllabus_id        integer     NOT NULL,
    old_department_id  integer     NOT NULL,
    new_department_id  integer     NOT NULL,
    merged_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TEMP TABLE dept_map (from_id integer PRIMARY KEY, to_id integer NOT NULL) ON COMMIT DROP;

INSERT INTO dept_map (from_id, to_id) VALUES
    ( 98, 23),  -- Stomatologiya va otorinoloringologiya   -> ...otorinolaringologiya
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
    ( 92, 14);  -- Mikrobiologiya, Virusalogiya             -> Mikrobiologiya,virusologiya,immunologiya

-- Xavfsizlik: manba kafedrada xodim yoki darslik bo'lsa — u nusxa emas,
-- haqiqiy kafedra. Bunday juftlik ko'chirilmaydi.
DELETE FROM dept_map m
WHERE EXISTS (SELECT 1 FROM core_staffprofile p WHERE p.department_id = m.from_id)
   OR EXISTS (SELECT 1 FROM core_bookchunk  c WHERE c.department_id = m.from_id);

-- Maqsad kafedra haqiqatan mavjudmi.
DELETE FROM dept_map m
WHERE NOT EXISTS (SELECT 1 FROM core_academicdepartment d WHERE d.id = m.to_id);

INSERT INTO dept_merge_backup (syllabus_id, old_department_id, new_department_id)
SELECT s.id, s.department_id, m.to_id
FROM core_coursesyllabus s
JOIN dept_map m ON m.from_id = s.department_id;

UPDATE core_coursesyllabus s
SET department_id = m.to_id
FROM dept_map m
WHERE s.department_id = m.from_id;

COMMIT;
