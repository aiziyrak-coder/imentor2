# USTA — loyiha yo'l xaritasi

## Maqsad
iMentor'ning AI token sarfini maksimal kamaytirish — **generatsiya sifatini
hech qaysi qismda pasaytirmasdan** (ma'ruza matni, test, vaziyatli masala,
taqdimot) va **hech qanday ma'lumotni o'chirmasdan**.

## Stack va struktura
- Frontend: React 19 + Vite + TS. AI promptlari — `frontend/src/services/aiService.ts`
- Backend: FastAPI. OpenAI proksi — `backend_fastapi/app/services/openai_client.py`,
  marshrut — `app/api/routes/education_ai.py`
- RAG: PostgreSQL + pgvector, `core_bookchunk` (760 902 chunk, HNSW indeks),
  qidiruv — `app/services/book_retrieval.py`
- Server: 192.168.0.101, `/home/imentor`, `docker-compose.prod.yml`

## O'lchangan holat (2026-09-01)

**Boshlang'ich muammolar**

| Nima | Qiymat | Xulosa |
|---|---|---|
| Chunk o'rtacha hajmi | 3 174 belgi (mediana 3 875) | RAG uchun 3-4 barobar katta |
| Aynan takroriy chunklar | **57.1%** (760 902 → 326 351 noyob) | bir matn 2-3 marta yuboriladi |
| `hnsw.ef_search` | 40 (standart) | 30 nomzod so'ralganda 13 ta qaytardi |
| RAG joylashuvi | promptning ENG BOSHIDA | prompt-kesh hech qachon ishlamasdi |
| Taqdimot 2-bosqichi | RAG'ni QAYTA yuklardi | ~8 500 token behuda |
| Token hisobi | yo'q | o'lchab bo'lmasdi |

**Natija (haqiqiy o'lchov, `oftalmologiya-di-10-s`, glaukoma mavzusi)**

| Ko'rsatkich | Oldin | Keyin |
|---|---|---|
| RAG belgilari | 26 006 | 11 514 (**−56%**) |
| Nomzodlar (filtrdan keyin) | 13 | 30 (**haqiqiy top-10**) |
| Noyob parchalar | ~7 | 10 |
| Keshdan olingan kirish | 0 | 3 968 / 7 259 (**55%**) |
| Kirish tokeni (to'liq narx ekvivalenti) | ~10 900 | ~5 300 (**−51%**) |
| Chiqish tokeni | o'zgarmagan | o'zgarmagan |

## Yo'l xaritasi (bosqichlar)
- [x] 0. O'rganish va o'lchash
- [x] 1. Token hisobi (`OPENAI_USAGE` log qatori, `IMENTOR_LOG_LEVEL`)
- [x] 2. Qidiruvda takrorni yo'qotish (`dedupe_chunks`) — baza tegilmaydi
- [x] 3. Chunkdan savolga mos oynani kesish (`focus_window`, 1200 belgi)
- [x] 4. Promptni kesh uchun qayta tartiblash (`_insert_book_context`)
- [x] 5. Taqdimot 2-bosqichidan ortiqcha RAG olib tashlandi
- [x] 6. `hnsw.ef_search = 200` — filtrdan keyin ham to'liq nomzod
- [x] 7. Testlar: 84 backend (18 tasi yangi RAG uchun) + 160 frontend, tsc toza
- [ ] 8. Bir hafta kuzatish: `OPENAI_USAGE` bo'yicha haqiqiy oylik sarfni hisoblash  <- KEYINGI

## Muhim qarorlar
- **2026-09-01 — ma'lumot o'chirilmaydi.** Bazadagi 57% takror chunk joyida
  qoladi; takror faqat **qidiruv paytida** filtrlanadi (`dedupe_chunks`).
- **2026-09-01 — sifat pasaymaydi, ortadi.** Uchala o'zgarish ham sifatga
  ijobiy: model 10 ta HAR XIL manba ko'radi (avval ~7 ta + nusxalar),
  parchalar savolga mos joyidan kesiladi (shovqin kamayadi), va `ef_search`
  tufayli haqiqiy eng yaqin parchalar keladi.
- **2026-09-01 — `FOCUS_WINDOW_CHARS = 1200`** (`book_retrieval.py`). Agar
  biror generatsiya yupqaroq tuyulsa — shu bitta sonni oshirish kifoya.
- **2026-09-01 — `hnsw.ef_search = 200`** bazada saqlanadi va
  `migrate-entrypoint.sh` orqali har deployda qayta qo'yiladi.

## Ochiq savollar / xavflar
- Mexanik qadamlar (savol tarjimasi, variant izohi) uchun arzonroq model —
  qo'shimcha ~20-30% tejash mumkin, lekin foydalanuvchi tasdig'i kutilyapti.
- OpenAI prompt-keshi ~5-10 daqiqa yashaydi: bir vaqtda ko'p o'qituvchi
  ishlaganda kesh ko'p tegadi, yolg'iz ishlaganda kamroq.
- Bazadagi 408 254 ortiqcha chunk hamon joyida (~16.9 GB disk, indeks
  hajmi 3 966 MB). O'chirilsa indeks kichrayadi va qidiruv tezlashadi —
  lekin bu ma'lumot o'chirish, foydalanuvchi qaroriga qoldirilgan.
