# USTA — loyiha yo'l xaritasi

## Maqsad
iMentor'ga **Online ta'lim** moduli qo'shish: 6-kurs masofaviy talabalari uchun
alohida portal (`onlinetalim.fermi.uz`). Mavjud iMentor **o'zgarmaydi** —
faqat admin panelga bitta yangi "Online ta'lim" sahifasi qo'shiladi.

## Asosiy shart
> «Loyiha shu joygacha umuman o'zgarmasin.»

Shuning uchun online modul **butunlay alohida jadvallarda** (`online_*` prefiksi)
va **alohida API** (`/api/v1/online/...`) da quriladi. Sabab: mavjud
`TopicHandout` / `TopicVideo` / `PreparedContent` jadvallarini FILTRSIZ
ro'yxatlaydigan 4 ta joy bor (`content_catalog.py:79`, `topic_content.py:296`,
`topic_content.py:519`, `content_catalog.py:723`) — o'sha jadvallarni ulashsak,
online materiallar hozirgi iMentor katalogida ko'rinib qolardi.

## Stack
- Backend: FastAPI + SQLAlchemy + Alembic · `backend_fastapi/app/`
- Frontend: React 19 + Vite + TS · `frontend/src/`
- Baza: PostgreSQL 16 + pgvector · Server: 192.168.0.101, `/home/imentor`
- Video: Jitsi Meet (serverda o'zimizniki), IFrame API orqali davomat

## Tasdiqlangan qarorlar (2026-09-01)
| Savol | Qaror |
|---|---|
| Video konferensiya | **Jitsi — serverning o'zida**, davomat avtomatik |
| Talaba login | **OnlineTest ID + parol** (guruh nomi avtomatik keladi) |
| Mavzu ochilishi | **O'qituvchi "dars o'tildi" tugmasini bosganda** |
| Baholash | **10 ta test — avtomatik** (keys va davomat ballga kirmaydi) |
| O'qituvchi qayerda ishlaydi | **`onlinetalim.fermi.uz` da** — iMentor'ga tegilmaydi |
| Test urinishi | **Bir marta** — ball qat'iy |

## Qabul qilingan taxminlar (so'ralmagan, o'zim hal qildim)
- Online sillabuslar mavjud sillabus yuklash formatida (Excel/Word) yuklanadi,
  lekin `online_syllabus` jadvaliga tushadi.
- O'qituvchini adminning o'zi "online" deb belgilaydi va fanga biriktiradi —
  mavjud `StaffCourseSelection` tegilmaydi.
- Talaba profili faqat online portalda; hozirgi iMentor talaba oynasi
  o'zgarmaydi.
- `onlinetalim.fermi.uz` bir xil frontend konteyneridan xizmat qiladi;
  `main.tsx` domen nomiga qarab `<OnlineApp/>` ni ko'rsatadi. Mavjud
  `App.tsx` ochilmaydi ham.

## Yangi jadvallar
| Jadval | Nima uchun |
|---|---|
| `online_syllabus` | 6-kurs fanlari (mavzular JSONB) |
| `online_teacher` | qaysi o'qituvchi online o'tadi |
| `online_teacher_course` | o'qituvchi ↔ fan |
| `online_group` | guruh (OnlineTest `group_name`) |
| `online_group_course` | guruh ↔ fan |
| `online_material` | ma'ruza, taqdimot, video, tarqatma, keys, test |
| `online_lesson` | video dars sessiyasi + mavzu qulfi |
| `online_attendance` | kim qachon kirdi/chiqdi |
| `online_progress` | talaba: ko'rilgan material + test bali |

## Yo'l xaritasi (bosqichlar)
- [x] 0. O'rganish, savollar, TZ
**Ajratish:** portal o'z domenida (`onlinetalim.fermi.uz`) VA o'z konteynerida
(`frontend_online`, 9060-port). Uni yangilash iMentor frontendini qimirlatmaydi —
sinovda tasdiqlandi: portal 18 soniya, iMentor 48 daqiqa uzluksiz.

- [x] 1. Baza: 9 ta jadval + migratsiya `h8i9j0k1l2m3` (upgrade/downgrade sinovdan o'tdi,
      productionga qo'llandi — mavjud 479 sillabus va 153 kontent joyida)
- [x] 2. Admin: "Online ta'lim" sahifasi — sillabus yuklash (mavjud tahlilchi qayta
      ishlatildi), o'qituvchi va guruh biriktirish, darslar va natijalar jadvali.
      API sinovdan o'tdi: o'qituvchi→403, tokensiz→401, eski katalog 200 yozuv joyida.
- [x] 3. O'qituvchi kabineti: portal qobig'i (`onlinetalim.fermi.uz`), kirish
      (o'qituvchi telefon+parol, talaba OnlineTest ID), fan → mavzu → 6 material.
      Ruxsat sinovdan o'tdi: biriktirilmagan foydalanuvchi 403, qayta saqlashda dublikat yo'q.
- [x] 4. Video dars, davomat va mavzu qulfi. Jitsi domeni serverdan olinadi
      (`/online/config/`), davomat IFrame API hodisalaridan, vaqtni server qo'yadi.
      O'rnatish skriptlari: `deploy/setup-onlinetalim.sh`, `deploy/setup-jitsi.sh`.
- [x] 5. Talaba kabineti: fanlar → qulflangan mavzular → material → 10 ta test
      (bir marta). Jonli darsga qo'shilish tugmasi, davomat avtomatik.
      Guruh TOKENDAN olinadi — brauzerdan emas.
- [ ] 6. Baholash va hisobotlar  <- HOZIR SHU YERDA (`onlinetalim.fermi.uz`): qulflangan mavzular, material, test
- [ ] 7. Deploy, testlar, hujjat

## Sizdan kerak bo'ladi (bloklovchi, men qila olmayman)
0. **nginx sayti** `onlinetalim.fermi.uz` uchun — `/etc/nginx` ga yozish sudo
   paroli talab qiladi, menda yo'q. Aniq buyruqlar javobda berilgan.
1. **`meet.fermi.uz`** uchun DNS A yozuvi → `87.192.230.208`
   (`onlinetalim.fermi.uz` allaqachon to'g'ri ko'rsatyapti ✅)
2. **Routerda UDP 10000 portini** `192.168.0.101` ga yo'naltirish —
   Jitsi videosi shu port orqali yuradi. Busiz tashqaridagi talaba
   video ko'ra olmaydi.
   Tayyor bo'lguncha vaqtincha `meet.jit.si` ishlatiladi (davomat baribir
   avtomatik ishlaydi) — `VITE_JITSI_DOMAIN` bitta sozlama.

## Xavfsizlik to'ri
- Boshlang'ich holat: commit `46eb2e7` (GitHub `production-snapshot`).
  Nimadir buzilsa shu commitga qaytamiz.
- Har bosqich oxirida testlar o'tgach commit qilinadi.
- Migratsiyadan oldin baza zaxirasi olinadi (`pg_dump`).

## Sinov ma'lumoti (oxirida o'chiriladi)
Serverda sinov uchun yaratilgan: `Ichki kasalliklar (online sinov)` fani (id 1),
`998901112233` o'qituvchi, `601-guruh`. 7-bosqichda tozalanadi.

## Ochiq savollar / xavflar
- Jitsi ~4-8 GB RAM oladi. Serverda hozir 41 GB bo'sh — yetadi, lekin
  bir vaqtda ko'p dars bo'lsa kuzatib borish kerak.
- Mexanik AI qadamlari uchun arzon model (avvalgi ish) — hali tasdiqlanmagan.
