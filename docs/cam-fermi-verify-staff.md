# cam.fermi.uz → iMentor: JSHSHIR + yuz bilan xodimni tasdiqlash

Bu fayl ikki tizim orasidagi shartnoma. Pastdagi "Prompt" bo'limi cam.fermi.uz
(`/opt/camera/camera-api`) dasturchisiga — yoki o'sha loyihada ishlaydigan
Claude sessiyasiga — so'zma-so'z beriladi. iMentor tomoni shu shartnomaga
yozilgan: `backend_fastapi/app/services/cam_verify.py`.

---

## Prompt (cam.fermi.uz uchun)

> camera-api (FastAPI, `/opt/camera/camera-api`) loyihasiga iMentor uchun bitta
> server-to-server endpoint qo'sh. Maqsad: iMentor login sahifasida xodim faqat
> JSHSHIRini yozadi; iMentor backend JSHSHIRni bizga yuboradi; biz shu JSHSHIRli
> faol xodimni topsak `verified=true` va uning ma'lumotlarini qaytaramiz. iMentor
> shu javob bilan xodimni tizimga kiritadi (hisobi bo'lmasa — shu ma'lumotlar
> bilan ochadi). Keyinchalik iMentor kadrlar ham yuborishi mumkin — u holda yuz
> 1:1 solishtiriladi (pastda, ixtiyoriy qism).
>
> ### Endpoint
>
> `POST /api/external/imentor/verify-staff`
>
> * **Autentifikatsiya:** `X-Api-Key` sarlavhasi. Kalit `.env` dagi
>   `IMENTOR_VERIFY_API_KEY` bilan `hmac.compare_digest` orqali solishtiriladi.
>   Kalit bo'sh bo'lsa endpoint 503 qaytaradi (tasodifan ochiq qolmasin).
>   Noto'g'ri kalit — 401. Bu endpoint foydalanuvchi sessiyasini/JWT ni talab
>   qilmaydi, faqat kalit.
> * **So'rov:** `multipart/form-data` (iMentor hozir `application/x-www-form-urlencoded`
>   yuboradi — FastAPI `Form(...)` ikkalasini ham qabul qiladi)
>   * `pinfl` — 14 raqam (`^\d{14}$`), aks holda 422;
>   * `frames` — IXTIYORIY: 0 yoki 2 ta JPEG, har biri ≤ 2 MB (1 ta yoki 3+ — 422);
>   * `request_id` — iMentor yuboradigan UUID (audit uchun, ixtiyoriy).
> * **Rate limit:** bitta `pinfl` uchun 10 daqiqada 5 urinish → 429.
>   Umumiy: kalit bo'yicha 300/daqiqa.
>
> ### Tekshirish tartibi
>
> 1. `students_staff` dan `pinfl` bo'yicha `type='xodim'` va faol yozuvni top.
>    Topilmasa — `verified=false, reason="not_found"`.
>    Bir JSHSHIR ikki faol yozuvda bo'lsa — `reason="ambiguous"` (taxmin qilinmaydi).
> 2. Xodim faol bo'lmasa (o'chirilgan/ishdan ketgan) — `reason="inactive"`.
>    **`frames` yuborilmagan bo'lsa shu yerda to'xta: `verified=true` + `person`.**
>
> Quyidagi 3–6 faqat `frames` yuborilganda:
>
> 3. Shu shaxsning TASDIQLANGAN yuz shablon(lar)i bo'lmasa — `reason="no_face_enrolled"`.
> 4. Ikkala kadrdan mavjud pipeline (yuz yozish/`/api/face/compare` dagi bilan bir xil
>    model) orqali embedding ol. Kadrlarning birortasida yuz bo'lmasa yoki bir nechta yuz
>    bo'lsa — `reason="no_face_in_frame"`.
> 5. Oddiy jonlilik: ikki kadr bir xil bayt bo'lmasin va ikki embedding orasidagi
>    o'xshashlik ~1.0 (aynan bir xil rasm) bo'lmasin — aks holda `reason="liveness_failed"`.
> 6. Har kadrni shaxsning shablonlari bilan solishtir. IKKALA kadr ham chegaradan
>    o'tsa — `verified=true`. Chegara — yuz orqali tanishda ishlatilayotgan qiymat,
>    `.env` da `IMENTOR_VERIFY_THRESHOLD` bilan sozlanadigan bo'lsin.
>    Aks holda — `reason="face_mismatch"`.
> 7. Har urinishni (kadrli va kadrsiz) audit jurnaliga yoz: vaqt, pinfl (oxirgi 4 raqami ko'rinadigan
>    qilib), `request_id`, natija, score, IP. Kadrlarni SAQLAMA.
>
> ### Javob (har doim 200, faqat kalit/format/limit xatolarida 401/422/429/503)
>
> ```json
> {
>   "verified": true,
>   "reason": "",
>   "score": 0.71,
>   "person": {
>     "id": "<students_staff.id UUID>",
>     "pinfl": "42005954100011",
>     "full_name": "ABDULLAYEVA ZARNIGOR AZAMAT QIZI",
>     "last_name": "ABDULLAYEVA",
>     "first_name": "ZARNIGOR",
>     "middle_name": "AZAMAT QIZI",
>     "position": "Assistent",
>     "department": "Patologik fiziologiya va patologik anatomiya",
>     "hemis_employee_id": "3442412062",
>     "phone": "998901234567"
>   }
> }
> ```
>
> * `verified=false` bo'lsa `person` — `null` (begona odamga ma'lumot qaytarilmaydi),
>   `reason` — `not_found | ambiguous | no_face_enrolled | no_face_in_frame |
>   liveness_failed | face_mismatch | inactive`.
> * Bizda bo'lmagan maydon — bo'sh satr (`""`), maydonning o'zi tushib qolmasin.
>   `hemis_employee_id` HEMIS integratsiyasidan olinadi (bo'lsa).
>
> ### Testlar
>
> Kalitsiz/noto'g'ri kalit 401; kalit sozlanmagan 503; noto'g'ri pinfl 422;
> topilmagan pinfl → not_found va person=null; faol emas → inactive;
> kadrsiz, topilgan faol xodim → verified=true va to'liq person;
> kadrli: shablonsiz → no_face_enrolled;
> boshqa odamning yuzi → face_mismatch; ikki bir xil kadr → liveness_failed;
> to'g'ri yuz → verified=true va barcha person maydonlari; 6-urinish 429.

---

## iMentor tomonida sozlash

`/home/imentor/.env`:

```
CAM_VERIFY_URL=http://camera-api-api-1:8080
CAM_VERIFY_API_KEY=<cam.fermi.uz dagi IMENTOR_VERIFY_API_KEY bilan bir xil>
```

Ikkalasi ham bo'sh bo'lsa yangi kirish yo'li o'chiq turadi (503), boshqa kirish
yo'llari o'zgarmaydi. Kalitni ikki `.env` ga qo'lda yozing, git'ga qo'shmang.

Login sahifasida: login maydoniga 14 xonali JSHSHIR, parol BO'SH → `POST /api/v1/auth/pinfl-login/`.
Parol yozilsa — avvalgidek JSHSHIR + parol. Yuz orqali kirish o'zgarmagan.
Faqat `hodim` hisobiga kiradi (admin/klinika admini — 403). JSHSHIR bo'yicha soatiga 10,
IP bo'yicha umumiy login cheklovi. Har kirish `core_useractivityevent` ga
`meta.method="pinfl_cam"` bilan yoziladi; ochilgan hisob — `account_created=true`.
