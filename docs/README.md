# iMentor — Salomatlik AI

**iMentor** — tibbiyot ta'limi va innovatsiya uchun AI yordamchi platforma. O'qituvchilar fan rejasi (syllabus) asosida ma'ruza, case study, test va prezentatsiya yaratadi; talabalar QR orqali jonli testda qatnashadi; xodimlarning kampusdagi joylashuvi GPS orqali nazorat qilinadi; startap loyihalari AI yordamida rasmiylashtiriladi.

| | |
|---|---|
| **Production** | [imentor.uz](https://imentor.uz) |
| **API** | `https://imentor.uz/api` |
| **API hujjatlari** | `/api/docs/` (Swagger UI) |
| **Admin panel** | `/admin/` (telefon raqam orqali kirish) |
| **Admin qo‘llanmasi (SPA)** | [docs/ADMIN_README.md](docs/ADMIN_README.md) — to‘liq flow, modullar, test checklist |
| **Tashqi API (partner)** | [docs/EXTERNAL_TESTS_API.md](EXTERNAL_TESTS_API.md) — katalog + testlar + keys, X-Api-Key |
| **To'liq oqim + integratsiya** | [docs/FULL_PLATFORM_FLOW.txt](docs/FULL_PLATFORM_FLOW.txt) — kafedra→fan→test→tashqi API |

---

## Mundarija

- [Imkoniyatlar](#imkoniyatlar)
- [Texnologiyalar](#texnologiyalar)
- [Arxitektura](#arxitektura)
- [Loyiha tuzilishi](#loyiha-tuzilishi)
- [Rollar va foydalanuvchilar](#rollar-va-foydalanuvchilar)
- [Tez boshlash](#tez-boshlash)
- [Muhit o'zgaruvchilari](#muhit-ozgaruvchilari)
- [API endpointlar](#api-endpointlar)
- [Docker Compose](#docker-compose)
- [Production deploy](#production-deploy)
- [Testlar](#testlar)
- [CI/CD](#cicd)
- [Demo hisoblar](#demo-hisoblar)
- [Administrator paneli (to‘liq qo‘llanma)](docs/ADMIN_README.md)
- [Xavfsizlik](#xavfsizlik)
- [Muammolarni bartaraf etish](#muammolarni-bartaraf-etish)

---

## Imkoniyatlar

### Ta'lim modullari (hodim)

- Fan rejasi (syllabus) katalogidan fan va mavzu tanlash (o'zbek, rus, ingliz tillarida)
- **OpenAI** yordamida ma'ruza, case study, test savollari va prezentatsiya yaratish
- Mavzuga bog'liq qo'llanmalar (PDF/rasm) va prezentatsiya fayllarini yuklash va ulashish
- Tayyorlangan kontentni saqlash va umumiy katalogga chiqarish (vaqt o'tgach)
- **Jonli test** — QR kod orqali talabalarga test yuborish (autentifikatsiyasiz)

### Xodim nazorati (GPS)

- Desktop va mobil qurilmani **QR orqali ulash** (device pairing)
- Mobil ilovadan GPS ping yuborish
- Dars jadvali va kampus binolari geofence bilan solishtirish
- Admin panelda joylashuv tarixi va ogohlantirishlar

### Startap / innovatsiya (startuper)

- AI savolnoma va 20 mezon bo'yicha baholash
- Innovation pack va coach chat
- Loyiha dosyesini rasmiylashtirib admin inboxga yuborish

### Admin

- Xodimlarni yaratish/o'chirish (telefon raqam orqali)
- Fan rejasi katalogini boshqarish
- Kampus binolari va dars jadvalini sozlash
- Kontent kutubxonasi, case/test arxivi, startap inbox
- Ma'lumotlarni to'liq eksport qilish

### Ochiq katalog

- `?library=1` yoki `#public-catalog` — autentifikatsiyasiz nashr qilingan materiallar

---

## Texnologiyalar

### Frontend (`frontend/`)

| Texnologiya | Versiya | Vazifa |
|---|---|---|
| React | 19 | UI |
| TypeScript | 5.8 | Tip xavfsizligi |
| Vite | 6 | Build va dev server |
| Tailwind CSS | 4 | Styling |
| Leaflet | 1.9 | Xarita (GPS) |
| Motion | 12 | Animatsiyalar |
| pdfjs-dist, mammoth, docx, jspdf, pptxgenjs | — | Hujjat import/eksport |
| html5-qrcode, qrcode | — | QR skaner va generatsiya |

### Backend (`backend/`)

| Texnologiya | Versiya | Vazifa |
|---|---|---|
| Python | 3.12 | Runtime |
| Django | 6.0.4 | Web framework |
| Django REST Framework | 3.17.1 | REST API |
| SimpleJWT | 5.5.1 | JWT autentifikatsiya |
| drf-spectacular | 0.28.0 | OpenAPI / Swagger |
| django-jazzmin | 3.0.1 | Admin UI |
| gunicorn | 23.0.0 | Production WSGI |
| PostgreSQL | 16 | Ma'lumotlar bazasi |
| Redis | 7 | Cache, throttle, Celery broker |
| Celery | 5.4 | AI vazifalar (background worker) |
| OpenAI API | gpt-4.1-nano (+ text-embedding-3-small) | AI generatsiya |

- Docker + Docker Compose (`dev` va `prod` — alohida to'liq stack fayllar)
- Docker ichidagi **nginx gateway** — frontend, API va media routing
- Host nginx (serverda qo'lda) — SSL va domen

---

## Arxitektura

```
Brauzer
   │
   ▼
Host nginx (serverda, SSL) ──► Docker nginx gateway (:9050)
                                   ├── /api/*, /media/* ──► backend ×N
                                   └── / ─────────────────► frontend (SPA)
                                                              │
                                                    celery_worker
                                                              │
                                                    postgres + redis
```

- **migrate** — bir martalik servis: migratsiya, static, bootstrap admin
- **backend** — `RUN_MIGRATIONS=0`, `--scale backend=2` tavsiya (gateway load balance qiladi)
- **celery_worker** — OpenAI chaqiruvlari (ta'lim va startap AI)
- **redis** — cache, rate-limit, Celery broker, AI job holati
- **postgres** — asosiy ma'lumotlar bazasi (SQLite ishlatilmaydi)

---

## Loyiha tuzilishi

```
imentor/
├── backend/
│   ├── config/                 # Django settings, Celery, urls, wsgi
│   ├── core/                   # Biznes-logika
│   │   ├── models.py
│   │   ├── urls.py
│   │   ├── views.py
│   │   ├── *_views.py          # Modul bo'yicha viewlar
│   │   ├── openai_client.py    # OpenAI HTTP client
│   │   ├── tasks.py            # Celery AI tasklar
│   │   ├── ai_jobs.py          # AI job holati (Redis cache)
│   │   ├── ai_async.py         # Job dispatch + kutish
│   │   ├── throttling.py       # Rate limit
│   │   ├── pagination.py
│   │   ├── tests.py            # Asosiy API testlar
│   │   ├── test_*.py           # Qo'shimcha test modullar
│   │   └── migrations/
│   ├── entrypoint.sh           # gunicorn
│   ├── migrate-entrypoint.sh   # migrate + static (bir martalik)
│   ├── celery-entrypoint.sh    # celery worker
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── api/
│   │   ├── components/         # admin, auth, staff, startup, public
│   │   ├── services/           # aiService, openaiClient
│   │   ├── utils/
│   │   └── i18n/               # uz / ru / en
│   ├── docker/nginx.conf
│   ├── Dockerfile
│   └── package.json
├── deploy/
│   ├── .env.production.example
│   ├── set-django-secret.sh
│   └── nginx/
│       ├── Dockerfile          # Docker gateway
│       └── docker-gateway.conf
├── docker-compose.dev.yml      # Lokal dev (gateway :8080)
├── docker-compose.prod.yml     # Production (IMENTOR_HTTP_PORT)
├── .env.example
└── README.md
```

---

## Rollar va foydalanuvchilar

Autentifikatsiya **telefon raqam** (username = `998XXXXXXXXX`) va parol orqali amalga oshiriladi. JWT token `role` claim bilan qaytariladi; ruxsatlar **DB guruhlari** bo'yicha tekshiriladi (JWT dagi eski role ishonilmaydi).

| Rol | Kirish huquqi |
|---|---|
| `admin` | Barcha modullar, xodim boshqaruvi, kampus, jadval, startap inbox |
| `hodim` | Ta'lim modullari, GPS ping, kontent yaratish |
| `startuper` | Startap/innovatsiya workspace |
| `klinika_admin` | Klinika guruhlari |

Production'da ochiq ro'yxatdan o'tish o'chirilgan — faqat admin `admin-provision-staff` orqali xodim qo'shadi.

---

## Tez boshlash

### Variant A — Docker (tavsiya etiladi)

```bash
git clone <repo-url> imentor
cd imentor
cp .env.example .env
# .env ichida DJANGO_SECRET_KEY, POSTGRES_PASSWORD, OPENAI_API_KEY to'ldiring

docker compose -f docker-compose.dev.yml up --scale backend=2 --build
```

| Manzil | URL |
|---|---|
| Ilova (gateway) | http://localhost:8080 |
| Swagger | http://localhost:8080/api/docs/ |
| Health check | http://localhost:8080/api/health/ |

> Dev: bitta gateway port **8080** — `/api` va SPA bir joydan ishlaydi.

### Variant B — Native (faqat backend/frontend alohida)

PostgreSQL va Redis lokalda ishlashi kerak.

**Backend:**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export DJANGO_ENV=dev
export DJANGO_DB_ENGINE=postgresql
export DJANGO_DB_HOST=127.0.0.1
export DJANGO_DB_PASSWORD=<parol>
export REDIS_URL=redis://127.0.0.1:6379/0
export OPENAI_API_KEY=<kalit>

python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

**Celery worker** (boshqa terminalda):

```bash
cd backend && source .venv/bin/activate
celery -A config worker -l info -Q ai,default
```

**Frontend:**

```bash
cd frontend
npm ci
```

`frontend/.env.local`:

```env
VITE_API_BASE_URL=http://localhost:8000/api
VITE_AI_VIA_BACKEND=true
```

```bash
npm run dev
```

| Manzil | URL |
|---|---|
| Frontend | http://localhost:5173 |
| API | http://localhost:8000/api |

### Variant C — Production profil (lokal test)

```bash
cp deploy/.env.production.example deploy/.env.production
# deploy/.env.production ni to'ldiring

docker compose -f docker-compose.prod.yml \
  --env-file deploy/.env.production \
  up --scale backend=2 --build
```

Default port: `http://127.0.0.1:9050` (`IMENTOR_HTTP_PORT=9050`).

---

## Muhit o'zgaruvchilari

### Asosiy (`.env` yoki `deploy/.env.production`)

| O'zgaruvchi | Tavsif | Default |
|---|---|---|
| `DJANGO_SECRET_KEY` | Django secret (prod: ≥40 belgi) | — |
| `POSTGRES_PASSWORD` | PostgreSQL paroli | — |
| `OPENAI_API_KEY` | OpenAI API kaliti | — |
| `DJANGO_ALLOWED_HOSTS` | Ruxsat etilgan hostlar | — |
| `DJANGO_CORS_ALLOWED_ORIGINS` | CORS originlar | — |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | CSRF trusted originlar | — |
| `VITE_API_BASE_URL` | Frontend API bazasi | `/api` |
| `ADMIN_PHONE` | Bootstrap superuser telefoni | — |
| `ADMIN_PASSWORD` | Bootstrap superuser paroli | — |
| `IMENTOR_HTTP_PORT` | Prod gateway porti | `9050` |
| `IMENTOR_HTTP_BIND` | Prod bind manzili | `127.0.0.1` |

### Backend qo'shimcha

| O'zgaruvchi | Tavsif | Default |
|---|---|---|
| `DJANGO_ENV` | `dev` yoki `prod` | `dev` |
| `DJANGO_DEBUG` | Debug rejimi | `True` (dev) |
| `DJANGO_DB_ENGINE` | Faqat `postgresql` | `postgresql` |
| `REDIS_URL` | Redis URL | `redis://redis:6379/0` |
| `DJANGO_BEHIND_PROXY` | nginx/Cloudflare proxy | `False` |
| `DJANGO_SERVE_MEDIA` | Media fayllarni serve qilish | `True` (Docker) |
| `DJANGO_ALLOW_LEGACY_PREPARED_CONTENT_API` | Eski himoyasiz API | `False` (prod) |
| `DJANGO_ALLOW_OPEN_REGISTRATION` | Ochiq ro'yxatdan o'tish | `False` (prod) |
| `OPENAI_CHAT_MODEL` | Asosiy chat modeli | `gpt-4.1-nano` |
| `OPENAI_FAST_MODEL` | Tez model | `gpt-4.1-nano` |
| `OPENAI_REASONER_MODEL` | Murakkab reasoning | `gpt-4.1-nano` |
| `GUNICORN_WORKERS` | Gunicorn worker soni | `2` |
| `CELERY_CONCURRENCY` | Celery parallel tasklar | `4` (dev), `6` (prod) |
| `DJANGO_AI_EDUCATION_RATE` | Ta'lim AI limit | `60/hour` |
| `DJANGO_AI_STARTUP_RATE` | Startap AI limit | `40/hour` |
| `DJANGO_LOGIN_RATE` | Login limit (IP) | `20/minute` |
| `DJANGO_STAFF_PING_RATE` | GPS ping limit | `2/minute` |

### Frontend (mahalliy dev)

| O'zgaruvchi | Tavsif |
|---|---|
| `VITE_API_BASE_URL` | API bazaviy URL |
| `VITE_AI_VIA_BACKEND` | AI chaqiruvlarni backend orqali yuborish (`true` tavsiya) |
| `OPENAI_API_KEY` | Faqat `VITE_AI_VIA_BACKEND=false` bo'lsa kerak |
| `VITE_ENABLE_DEMO_AUTH` | Prod'da demo hisoblarni yoqish |

Shablonlar: `.env.example`, `deploy/.env.production.example`, `frontend/.env.example`

---

## API endpointlar

Barcha endpointlar `/api/` prefiksi ostida. Versiyalangan API: `/api/v1/...`

### Autentifikatsiya

| Method | Endpoint | Auth | Tavsif |
|---|---|---|---|
| POST | `/api/v1/auth/local-login/` | Ochiq | Telefon + parol → JWT |
| POST | `/api/v1/auth/token/` | Ochiq | Standart JWT obtain |
| POST | `/api/v1/auth/token/refresh/` | Ochiq | JWT yangilash |
| GET | `/api/v1/auth/me/` | JWT | Joriy foydalanuvchi |
| POST | `/api/v1/auth/change-password/` | JWT | Parol o'zgartirish |
| POST/DELETE | `/api/v1/auth/me/avatar/` | JWT | Avatar yuklash/o'chirish |
| POST | `/api/v1/auth/admin-provision-staff/` | Admin | Xodim yaratish |
| POST | `/api/v1/auth/admin-deprovision-staff/` | Admin | Xodimni o'chirish |

### Ta'lim va AI

| Method | Endpoint | Auth | Tavsif |
|---|---|---|---|
| GET/POST | `/api/v1/prepared-content/` | JWT + hodim | Tayyorlangan kontent |
| DELETE | `/api/v1/prepared-content/<pk>/` | JWT | Kontentni o'chirish |
| POST | `/api/v1/education-ai/completion/` | JWT + hodim | OpenAI (Celery orqali) |
| GET | `/api/v1/ai-jobs/<job_id>/` | JWT | AI job holati |
| GET | `/api/v1/course-syllabuses/catalog/` | JWT | Fan rejasi katalogi |
| GET/POST | `/api/v1/course-syllabuses/my/` | JWT | O'qituvchi fan tanlovlari |
| GET/POST | `/api/v1/admin/course-syllabuses/` | Admin | Katalog CRUD |
| GET/POST | `/api/v1/handouts/` | JWT | Qo'llanmalar |
| GET/POST | `/api/v1/presentations/` | JWT | Prezentatsiyalar |

### Jonli test (QR)

| Method | Endpoint | Auth | Tavsif |
|---|---|---|---|
| POST | `/api/v1/live-tests/` | JWT | Sessiya yaratish |
| GET | `/api/v1/live-tests/<session_key>/` | Ochiq | Talaba testni ko'radi |
| POST | `/api/v1/live-tests/<session_key>/drafts/` | Ochiq | Qoralama javoblar |
| POST | `/api/v1/live-tests/<session_key>/submissions/` | Ochiq | Yakuniy topshirish |
| POST | `/api/v1/live-tests/<session_key>/finalize/` | JWT | Sessiyani yopish |

### GPS va jadval

| Method | Endpoint | Auth | Tavsif |
|---|---|---|---|
| POST | `/api/v1/staff/location-ping/` | Hodim | GPS ping |
| GET | `/api/v1/staff/schedule/` | JWT | O'z jadvali |
| GET | `/api/v1/staff/buildings/` | JWT | Kampus binolari |
| GET/POST | `/api/v1/admin/campus-buildings/` | Admin | Bino CRUD |
| GET/POST | `/api/v1/admin/staff-schedule/` | Admin | Jadval CRUD |
| POST | `/api/v1/admin/staff-schedule/bulk/` | Admin | Ommaviy jadval import |
| GET | `/api/v1/admin/staff-location-pings/` | Admin | Joylashuv tarixi |
| GET | `/api/v1/admin/staff-location-alerts/` | Admin | Geofence ogohlantirishlar |

### Qurilma ulash (QR pairing)

| Method | Endpoint | Auth | Tavsif |
|---|---|---|---|
| POST | `/api/v1/device-pair/create/` | Ochiq | Desktop QR sessiya yaratadi |
| POST | `/api/v1/device-pair/confirm/` | JWT (mobil) | Mobil tasdiqlaydi |
| GET | `/api/v1/device-pair/status/<token>/` | Ochiq + secret | Ulanish holati |

### Startap

| Method | Endpoint | Auth | Tavsif |
|---|---|---|---|
| GET/POST | `/api/v1/startup-applications/` | Startuper | Loyihalar |
| POST | `/api/v1/startup-applications/<pk>/submit/` | Startuper | Admin inboxga yuborish |
| GET | `/api/v1/startup-applications/admin/inbox/` | Admin | Admin inbox |
| POST | `/api/v1/startup-ai/questionnaire/` | Startuper | AI savolnoma |
| POST | `/api/v1/startup-ai/twenty-criteria/` | Startuper | 20 mezon baholash |
| POST | `/api/v1/startup-ai/innovation-pack/` | Startuper | Innovation pack |
| POST | `/api/v1/startup-ai/coach-reply/` | Startuper | Coach chat |

### Kontent katalogi

| Method | Endpoint | Auth | Tavsif |
|---|---|---|---|
| GET | `/api/v1/content-catalog/` | JWT | Xodimlar kutubxonasi |
| GET | `/api/v1/public/content-catalog/` | Ochiq | Ochiq katalog |

### Tashqi API (hamkor servislar)

JWT emas — `X-Api-Key` header. To'liq hujjat: [EXTERNAL_TESTS_API.md](EXTERNAL_TESTS_API.md)

**Katalog** (kafedra/fan nomlari, mavzular — savolsiz):

| Method | Endpoint | Auth | Tavsif |
|---|---|---|---|
| GET | `/api/v1/external/catalog/stats/` | X-Api-Key | Kafedra/fan/yo'nalish/mavzu statistikasi + nomlar |
| GET | `/api/v1/external/catalog/departments/` | X-Api-Key | Kafedralar ro'yxati (code + name) |
| GET | `/api/v1/external/catalog/departments/<code>/` | X-Api-Key | Kafedra + uning fanlari |
| GET | `/api/v1/external/catalog/subjects/` | X-Api-Key | Fanlar ro'yxati |
| GET | `/api/v1/external/catalog/subjects/<code>/` | X-Api-Key | Yo'nalishlar + mavzular |

**Testlar** (hodim yaratgan savollar):

| Method | Endpoint | Auth | Tavsif |
|---|---|---|---|
| GET | `/api/v1/external/tests/stats/` | X-Api-Key | Test bazasi statistikasi |
| GET | `/api/v1/external/tests/` | X-Api-Key | E'lon qilingan testlar ro'yxati |
| GET | `/api/v1/external/tests/<id>/` | X-Api-Key | Test + savollar (`?question_limit=10..30&language=uz\|ru\|en`) |
| GET | `/api/v1/external/questions/sample/` | X-Api-Key | Unique bank; har savol `languages.uz/ru/en` (til param shart emas) |

**Keys** (case study savollar bazasi):

| Method | Endpoint | Auth | Tavsif |
|---|---|---|---|
| GET | `/api/v1/external/keys/stats/` | X-Api-Key | Keys bazasi statistikasi |
| GET | `/api/v1/external/keys/` | X-Api-Key | E'lon qilingan keyslar ro'yxati |
| GET | `/api/v1/external/keys/<id>/` | X-Api-Key | Keys + savollar (`?question_limit=1..50`) |
| GET | `/api/v1/external/keys/scenarios/` | X-Api-Key | Tekis savollar banki (`scenario`+`answer`) — UI ro'yxati uchun |

Server `.env`: `IMENTOR_EXTERNAL_API_KEYS=kalit1,kalit2`

Namuna skript: `deploy/examples/external_partner_client.py`

### Infratuzilma

| Method | Endpoint | Auth | Tavsif |
|---|---|---|---|
| GET | `/api/health/` | Ochiq | Health check |
| GET | `/api/schema/` | Ochiq | OpenAPI schema |
| GET | `/api/docs/` | Ochiq | Swagger UI |

To'liq ro'yxat: `backend/core/urls.py` yoki Swagger UI.

**Pagination:** ko'p list endpointlar `?page=1&page_size=50` qabul qiladi va `{count, page, page_size, results}` formatida javob qaytaradi.

---

## Docker Compose

Faqat **ikkita** compose fayl — har biri to'liq stack (postgres, redis, migrate, backend, celery, frontend, nginx gateway).

| Fayl | Maqsad | Port |
|---|---|---|
| `docker-compose.dev.yml` | Lokal dev | `http://localhost:8080` |
| `docker-compose.prod.yml` | Production | `http://127.0.0.1:${IMENTOR_HTTP_PORT}` |

### Servislar

| Servis | Vazifa |
|---|---|
| `postgres` | PostgreSQL 16 |
| `redis` | Cache + Celery broker |
| `migrate` | Bir martalik: migrate, collectstatic, admin bootstrap |
| `backend` | Gunicorn API (`--scale backend=2` tavsiya) |
| `celery_worker` | AI background tasklar |
| `frontend` | Vite build → static SPA |
| `nginx` | Gateway: `/` → frontend, `/api` → backend, `/media` → backend |

### Ishga tushirish

```bash
# Dev
docker compose -f docker-compose.dev.yml up --scale backend=2 --build

# Prod
docker compose -f docker-compose.prod.yml \
  --env-file deploy/.env.production \
  up --scale backend=2 -d --build
```

---

## Production deploy

Serverda faqat Docker stack ishga tushiring. **Host nginx** va **SSL** ni serverda o'zingiz sozlaysiz.

### 1. Muhit fayli

```bash
cp deploy/.env.production.example deploy/.env.production
sh deploy/set-django-secret.sh
nano deploy/.env.production
```

Majburiy: `POSTGRES_PASSWORD`, `ADMIN_PASSWORD`, `OPENAI_API_KEY`, `DJANGO_ALLOWED_HOSTS`, `DJANGO_CORS_ALLOWED_ORIGINS`, `DJANGO_CSRF_TRUSTED_ORIGINS`.

Port (default `9050`):

```env
IMENTOR_HTTP_BIND=127.0.0.1
IMENTOR_HTTP_PORT=9050
```

> `.env.production` git'ga commit qilinmaydi.

### 2. Docker Compose

```bash
docker compose -f docker-compose.prod.yml \
  --env-file deploy/.env.production \
  up --scale backend=2 -d --build
```

Tekshirish:

```bash
curl http://127.0.0.1:9050/api/health/
```

### 3. Server nginx (qo'lda)

Docker gateway portiga proxy qiling (masalan `9050`):

```nginx
location / {
    proxy_pass http://127.0.0.1:9050;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

SSL — serverda `certbot` yoki mavjud sertifikatingiz bilan.

---

## Testlar

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

DJANGO_ENV=dev DJANGO_SECURE_SSL_REDIRECT=False python manage.py test core -v 2
```

Test modullari: `tests.py`, `test_services.py`, `test_ai_celery.py`, `test_api_extended.py` (jami 56+ test).

---

## CI/CD

### GitHub Actions (`ci.yml`)

Har bir PR va `main`/`master` push'da:

| Job | Vazifa |
|---|---|
| `frontend` | `npm ci` → `tsc` → `vitest` → `vite build` |
| `backend` | `pip install` → `check --deploy` → `migrate` → `test` |
| `docker-smoke` | `docker compose -f docker-compose.prod.yml up` → health check |

---

## Demo hisoblar

Faqat **dev** rejimida yoki `VITE_ENABLE_DEMO_AUTH=true` bo'lganda ishlaydi.

| Rol | Telefon | Parol |
|---|---|---|
| Admin | `+998901110001` | `AdminDemo123` |
| Hodim | `+998901112233` | `TestHodim123` |
| Startuper | `+998901110003` | `StartupDemo123` |

> Hodim demo desktopda ishlamaydi — QR orqali mobil qurilmadan kirish kerak.

---

## Xavfsizlik

- `OPENAI_API_KEY` faqat serverda saqlanadi; frontend odatda backend proxy orqali AI chaqiradi
- Legacy himoyasiz API (`/api/prepared-content/`) production'da o'chirilgan
- Production'da ochiq ro'yxatdan o'tish o'chirilgan (`DJANGO_ALLOW_OPEN_REGISTRATION=False`)
- JWT tokenlar `localStorage`da saqlanadi
- Admin huquqi faqat DB `admin` guruhidan olinadi
- Rate limiting: login, AI, GPS ping, live test
- Production: HSTS, secure cookies, SSL redirect
- `.env`, `deploy/.env.production`, API kalitlari git'ga kirmaydi

---

## Muammolarni bartaraf etish

### Port topilmayapti

| Compose | URL |
|---|---|
| `docker-compose.dev.yml` | http://localhost:**8080** |
| `docker-compose.prod.yml` | http://127.0.0.1:**IMENTOR_HTTP_PORT** (default 9050) |

Tekshirish:

```bash
docker ps --format "table {{.Names}}\t{{.Ports}}"
curl http://localhost:8080/api/health/
```

### Backend ishlamayapti

```bash
docker compose -f docker-compose.dev.yml logs backend celery_worker
docker compose -f docker-compose.dev.yml logs migrate
```

### AI javob bermayapti

- `OPENAI_API_KEY` backend muhitida o'rnatilganligini tekshiring
- `celery_worker` konteyneri ishlayotganini tekshiring:
  ```bash
  docker compose -f docker-compose.dev.yml logs celery_worker
  ```

### Frontend API'ga ulanmayapti

- Docker'da `VITE_API_BASE_URL=/api` bo'lishi kerak (gateway `/api` ni backendga yo'naltiradi)
- Native dev'da `VITE_API_BASE_URL=http://localhost:8000/api`
- CORS: `DJANGO_CORS_ALLOWED_ORIGINS` ga frontend manzilini qo'shing

### PostgreSQL / Redis

Docker stack avtomatik ulaydi. Native dev uchun:

```bash
# PostgreSQL va Redis lokalda ishlashi shart
export REDIS_URL=redis://127.0.0.1:6379/0
export DJANGO_DB_HOST=127.0.0.1
```

### Kampus binolarini seed qilish

```bash
python manage.py seed_campus_buildings
```

### Xodimlarni rosterdan import qilish

```bash
python manage.py provision_teachers_roster --file roster.json --password '<kuchli-parol>'
```

---

## Litsenziya

Maxsus litsenziya ko'rsatilmagan. Tashqi kutubxonalar o'z litsenziyalariga ega.
