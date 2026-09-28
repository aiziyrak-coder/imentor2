# Ishni davom ettirish uchun (2026-09-28)

Loyiha boshqa dasturchiga topshirildi. Bu hujjat — kirish nuqtasi.
Umumiy tavsif `docs/README.md` da; bu yerda **hozirgi holat**, **qoidalar** va
**oson buziladigan joylar**.

---

## 1. AI yordamchiga beriladigan prompt

Quyidagini o'z AI yordamchingizga (Claude Code, Cursor va h.k.) birinchi
xabar sifatida bering:

> Men iMentor loyihasini davom ettiraman — Farg'ona jamoat salomatligi
> tibbiyot institutining o'qituvchilar uchun AI platformasi. U **ishlab
> turgan** tizim: har kuni yuzlab o'qituvchi va mingdan ortiq talaba
> foydalanadi, shuning uchun har o'zgarish ehtiyotkorlik talab qiladi.
>
> Boshlashdan oldin shularni o'qi: `HANDOVER.md` (shu fayl), `docs/README.md`,
> `deploy/push-to-server.sh` boshidagi izoh.
>
> Ish qoidalari:
> - Kod izohlari va foydalanuvchiga ko'rinadigan matn **o'zbekcha**. Izoh
>   "nima qilinayotganini" emas, **nega shunday qilinganini** tushuntiradi.
> - Har tuzatishga test yoz: backend `pytest`, frontend `vitest`. Ikkalasi
>   ham to'liq o'tmaguncha serverga chiqarma.
> - Raqam yoki ro'yxat ko'rsatadigan kod yozsang, uni **haqiqiy ma'lumotda**
>   tekshir (serverda `python -` orqali), faqat testga ishonma.
> - Serverdagi faylni qo'lda tahrirlama — faqat `deploy/push-to-server.sh`.
> - Repo **ochiq**: parol, token, pasport, telefon ro'yxati hech qachon
>   commitga tushmasin.
>
> Avval menga savol ber: nimani o'zgartirmoqchiman va nega. Keyin rejani
> ayt, men tasdiqlaganimdan keyin boshla.

---

## 2. Qayerda ishlaydi va qanday chiqariladi

| | |
|---|---|
| Sayt | `https://imentor.uz` — o'qituvchi va talaba |
| Rektor nazorati | `https://imentor.uz/rektor` — alohida parol bilan |
| Server | institut serveri, Docker Compose (`docker-compose.prod.yml`) |
| Konteynerlar | `imentor-backend_fastapi-1`, `imentor-frontend-1`, `imentor-frontend_online-1`, `imentor-postgres-1` |

**Chiqarish faqat shu skript bilan:**

```bash
bash deploy/push-to-server.sh <serverdagi-oxirgi-commit>
```

Skript o'zi: serverdagi fayllar ko'rsatilgan commitga mos kelishini
tekshiradi (mos kelmasa **hech narsa yubormaydi**), zaxira oladi, faqat
o'zgargan qismni yuboradi, migratsiya bo'lsa `migrate_fastapi` ni ham
qayta yig'adi, so'ng kerakli konteynerni qayta ishga tushiradi.

Orqaga qaytarish yo'li har safar oxirida chop etiladi
(`backups/push-before-<vaqt>.tgz` va `imentor-*:before-<vaqt>` image'lari).

**Sirlar** serverdagi `.env` da: HEMIS tokeni, dekan parollari, baza ulanishi.
Repoda faqat `.env.example` bor.

---

## 3. HEMIS — ma'lumotning asosiy manbasi

Dars jadvali, kontingent, kafedralar va xodimlar HEMIS'dan olinadi.
**HEMIS'ga hech narsa yozilmaydi** (faqat o'qish).

Har kuni cron bilan: `deploy/hemis/hemis-sync.sh` →

| Skript | Nima qiladi |
|---|---|
| `sync_hemis_schedule.py` | monitorli xonalardagi darslar |
| `sync_hemis_lessons.py` | jadvalning to'liq nusxasi (`core_hemislesson`) |
| `sync_hemis_students.py` | talabalar kontingenti |
| `sync_hemis_departments.py` | kafedralarni bog'lash (nom o'zgarmaydi) |
| `sync_hemis_staff.py` | profildagi bo'sh kafedra/lavozim + ish holati |

**O'qituvchini bog'lash tartibi** (`hemis_schedule.teacher_map`):
1. HEMIS `employee_id_number` = iMentor logini;
2. topilmasa — familiya + ism bo'yicha, faqat ikki tomonda ham yagona moslik;
3. Xodim ID hisobi ishlatilmagan, lekin o'sha odamning telefon raqamli
   hisobi faol bo'lsa — darslar faol hisobga yoziladi.

Adashlar (bir xil ismlilar) hech qachon taxmin bilan bog'lanmaydi.

---

## 4. Rektor nazorat paneli — oxirgi ishning asosiy qismi

**Savol bitta:** monitorli xonada dars o'tayotgan o'qituvchi shu darsda
iMentor'ni ochdimi. Ikkinchi qatlam: ochgani yetarli emas — nima qilgani ham
ko'rinadi (bo'lim bo'yicha daqiqa, yaratgan materiali, profil to'liqligi,
fan qamrovi).

| Fayl | Vazifasi |
|---|---|
| `app/services/control_report_service.py` | hisobotning butun mazmuni: `overview`, `students`, `people`, `teacher_detail` |
| `app/services/monitor_room_service.py` | xona holati: ishlayapti / tekshirish kerak / ma'lumot kam |
| `app/services/teacher_activity_service.py` | daqiqa, yaratilgan material, profil, fan qamrovi |
| `app/services/lesson_report_service.py` | darslar va "ishlatildi" o'lchovi |
| `frontend/src/rector/ControlReport.tsx` | sahifaning o'zi |
| `frontend/src/rector/StatDrill.tsx` | raqam bosilganda ochiladigan ro'yxat |
| `frontend/src/rector/PersonPanel.tsx` | bitta odamning batafsil hisoboti |

### Buzmaslik kerak bo'lgan ikki qoida

**a) Xona o'qituvchidan oldin baholanadi.** Agar xonada kimdir iMentor
ochgan bo'lsa — monitor ishlaydi va o'sha xonadagi boshqa o'qituvchining
bahonasi yo'q. Agar xonada ko'p dars va bir necha o'qituvchi bo'lib, hech
kim ocholmagan bo'lsa — ayb jihozda, o'qituvchida emas. Shuning uchun qizil
ro'yxat ikkiga bo'lingan: `attention` va `check_room`.

**b) Sahifadagi raqam = ro'yxatdagi odamlar soni.** Har bir raqam bosiladi
va ortidagi odamlarni ko'rsatadi. Ro'yxat ham, raqam ham bitta funksiyadan
(`teacher_rows`) chiqadi. Yangi ko'rsatkich qo'shsangiz,
`tests/test_control_people.py` ga "raqam == ro'yxat" tekshiruvini **albatta**
qo'shing — jonli ma'lumotda bu uch marta buzilgan va har safar test tutgan.

---

## 5. AI material: klinik yoki klinik emas

Ilgari platforma har fanga klinik material yozardi — informatika yoki til
mavzusiga ham bemor kartasi bilan. Endi uch daraja bor
(`frontend/src/utils/subjectDomain.ts`):

| Daraja | Kimga | Nima mumkin |
|---|---|---|
| `clinical` | institutning rasmiy 15 klinik kafedrasi yoki bemor qarorini talab qiladigan mavzu | bemor kartasi, tashxis, davolash |
| `biomedical` | anatomiya, fiziologiya, biokimyo, gigiyena… | mexanizm, tuzilma, laboratoriya me'yori; **bemor kartasi yo'q** |
| `academic` | til, IT, matematika, ijtimoiy fanlar | tibbiy mazmun umuman yo'q |

Qaror **mavzudan** boshlanadi, keyin kafedraga qaraydi. Noma'lum holat hech
qachon `clinical` emas. Rasmiy ro'yxat:
`backend_fastapi/app/data/clinical_departments.json` →
`core_academicdepartment.is_clinical` bayrog'i.

Eski, mos kelmaydigan material o'chirilmagan: `retired_reason` bilan
belgilangan, katalogdan va avtomatik yuklanishdan chiqarilgan, o'qituvchi
tarixida "eskirgan" belgisi bilan turibdi.

---

## 6. Oson buziladigan joylar (qimmatga tushgan darslar)

- **Sinf monitorlari — Android 9 / Chrome 85.** Yangi brauzer API ishlatsangiz
  `frontend/src/utils/polyfills.ts` ga qo'shing. PDF ko'rsatuvchi ataylab
  `pdfjs-dist/legacy` — oddiy build u yerda yiqiladi.
- **Deploy mosligi.** Serverdagi faylni qo'lda tahrirlasangiz, keyingi deploy
  butunlay to'xtaydi. Faqat skript orqali.
- **Migratsiya.** `migrate_fastapi` ning o'z image'i bor; qo'lda chiqarsangiz
  uni ham qayta yig'ish kerak (skript buni o'zi qiladi).
- **Kesh.** Profil va fan qamrovi 5 daqiqaga saqlanadi
  (`teacher_activity_service`); testlarda `tests/conftest.py` tozalaydi.
- **Dars bo'lmagan kun.** Yakshanba yoki bayramda jadval bo'sh bo'ladi —
  sahifa shundan qulamasligi kerak.
- **Bash heredoc ichida Python yozmang** (`bash -c "python - <<'PY'"`):
  `'\b'` kabi ketma-ketliklar faylga **boshqaruv belgisi** bo'lib tushadi va
  regex'lar jim buziladi. Skriptni alohida faylga yozing. Tekshiruv:
  `grep -rlP '\x08' .`

---

## 7. Testlar

```bash
cd backend_fastapi && python -m pytest -q     # ~435 test
cd frontend && npx vitest run                 # ~320 test
cd frontend && npx tsc --noEmit -p tsconfig.json
```

Uchalasi ham toza bo'lmaguncha serverga chiqarmang.

Dizaynni brauzerda ko'rish uchun namuna ma'lumotli sahifa:
`frontend/harness.html` (rektor paneli ham shu yerda).

---

## 8. Hal qilinmagan ishlar

Bular kod emas — institut tomonidan hal qilinadi. Tafsilotlarni loyiha
egasidan so'rang:

1. Monitori shubhali xonalar — texnik xizmat tekshirishi kerak.
2. HEMIS auditoriyalar ro'yxatida yo'q ikki xona; ular qo'shilmaguncha
   o'sha darslar "monitorli" deb hisoblanmaydi.
3. HEMIS jadvalida darsi bor, lekin iMentor hisobi topilmagan o'qituvchilar.
4. Ishdan ketgan xodimlarning ochiq hisoblari.
5. Bir odamga ikkita hisob ochilgan holatlar.
6. Hisoblar xavfsizligi bo'yicha loyiha egasi bilan alohida gaplashing —
   bu yerda yozilmaydi, chunki repo ochiq.
