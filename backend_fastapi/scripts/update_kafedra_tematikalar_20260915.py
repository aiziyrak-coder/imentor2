from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from sqlalchemy import select

from app.core.db import SessionLocal
from app.models.content import CourseSyllabus

DEPT_ID = 17
BACKUP_PATH = Path('/tmp/imentor_kafedra_tematikalar_backup_20260915.json')

def make_topics(lectures, practicals):
    rows=[]
    for i,title in enumerate(lectures,1):
        rows.append({'id': f'L{i}', 'type': 'lecture', 'title': title.strip()})
    for i,title in enumerate(practicals,1):
        rows.append({'id': f'A{i}', 'type': 'practical', 'title': title.strip()})
    return rows

COURSES = {
  2438: {
    'name': 'Mutaxassislikka kirish 1-s TPI',
    'file': 'Mutaxassislikka kirish.doc',
    'lectures': [
      "Gigiyenaning predmeti va vazifalari.",
      "SEO VA JSB larda qo'llaniladigan asos bo'luvchi qonuniy xujjatlar",
      "SEO VA JSB larda qo'llaniladigan umumdavlat va me'yoriy uslubiy qonunchilik xujjatlari",
      "Ogohlantiruvchi va joriy sanitariya nazoratlari haqida tushuncha",
    ],
    'practicals': [
      "Gigiyena fanining maqsad va vazifalari, rivojlanish tarixi",
      "Gigiyena fani bo'limlarga xos bo'lgan vazifalari bilan tanishish, tekshirish ob'ektlari haqida umumiy tushunchaga ega bo'lish",
      "Gigiyena fanida qo'llaniladigan profilaktik chora tadbirlar.",
      "Gigiyena sohasidagi asosiy qonuniy hujjatlar bilan tanishish.",
      "Gigiyena sohasidagi umumdavlat meyoriy qonuniy hujjatlar bilan tanishish.",
      "SEO va JSB o'quv moduli ish faoliyati asosida SEO va JSB tuzilishi bilan tanishish.",
      "Aholining sanitariya epidemiologik osoyishtalik va jamoat salomatligi xizmati sanitariya-gigiyena bo'limi faoliyati haqida tushuncha.",
      "Gigiyenaga oid qonuniy xujjatlar, SanQ va M larga asosan ish joyida turli gigiyenik tekshirishlar o'tkazish va me'yorlarga solishtirish",
      "Gigiyenada qo'llanadigan usullar haqida tushuncha. Sanitar tekshiruv usullari va ularning ahamiyati. Dalolatnoma shakllari va ularni to'ldirish qoidalari.",
      "Joriy sanitariya nazorati va dalolatnoma to'ldirish qoidalari",
      "Ogohlantiruvchi sanitariya nazorati. Ogohlantiruvchi sanitariya nazorati olib boriladigan ob'ektlar va ularga berilishi zarur bo'lgan xulosalar",
    ],
  },
  2439: {
    'name': 'Mutaxassislikka kirish 2-s TPI',
    'file': 'Mutaxassislikka kirish.doc',
    'lectures': [
      "Kommunal gigiyenasi fani maqsad vazifalari, o'rganish obyektlari.",
      "Ovqatlanish gigiyenasi fani maqsad vazifalari, o'rganish obyektlari.",
      "Bolalar va o'smirlar gigiyenasi fani maqsad vazifalari, o'rganish obyektlari.",
      "Mehanat gigiyenasi fani maqsad vazifalari, o'rganish obyektlari.",
      "Radiatsion gigiyena fani maqsad vazifalari, o'rganish obyektlari",
      "Epidemiologiya fani maqsad vazifalari, o'rganish obyektlari",
      "Sog'lom turmush tarzining gigiyenik asoslari. Shaxsiy gigiyena.",
      "O'zRda Davlat sanitariya nazorati. Aholi sanitariya-epidemiologik osoyishtaligini ta'minlash.",
    ],
    'practicals': [
      "Kommunal gigiyena fani uning tekshiruv ob'ektlari haqida tushuncha.",
      "Ishchi muhitining fizikaviy, kimyoviy va biologik omillarni tekshirish ob'ektlari haqida tushuncha olish, ishchi muhitining kimyoviy omillarni laborator tekshirish va ekologo-gigiyenik baholash.",
      "Atmosfera havosining ifloslanishi uning gigiyenik ahamiyati.",
      "Mikroiqlim ko'rsatkichlarini aniqlash va gigiyenik baholash.",
      "Xonalar havosining tozaligini tezkor usulda tekshirib baxolash asoslari. Xonada karbonat angidridni miqdorini tezkor usulda aniqlash, xona havosini gigiyenik baxolash.",
      "Laboratoriya tekshirishlari uchun suv namunalarini olish uslublari. Organoleptik tekshirish usuli yordamida suvni sifatini baholash.",
      "Atmosfera havosi, suv, tuproqning nomuvofiq omillarini gigiyenik reglamentlashga bo'lgan umumiy yondoshishlar",
      "Mahalliy va markazlashgan suv ta'minoti haqida tushuncha, ularning gigiyenik ahamiyati.",
      "Laboratoriya tekshirishlar uchun tuproqdan namuna olish usuli, tuproq orqali yuquvchi kasalliklar va ularning profilaktikasi.",
      "Ovqatlanish gigiyenasi fani haqida tushuncha. Ovqatlanish gigiyenasi bo'limining tekshiruv ob'ektlari haqida tushuncha.",
      "Ratsional ovqatlanish printsiplari, noto'g'ri ovqatlanish asoratlari.",
      "Asosiy ozuqaviy moddalar - oqsillar, yog'lar, karbonsuvlar, mineral moddalar, vitaminlarning biologik roli va asosiy manbalari.",
      "Kunlik ovqatlanish me'yorlari. Taomnoma tuzish usuli. Kunlik taomnomani taxlil qilish.",
      "Talabani sutkalik taomnomasini o'rganish va uni normativ qoidalarga mosligini aniqlash",
      "Bolalar va o'smirlar gigiyenasi fani haqida tushuncha. Bolalar va o'smirlar gigiyenasi bo'limining tekshiruv ob'ektlari haqida tushuncha.",
      "Bolalar va o'smirlarning jismoniy rivojlanish ko'rsatkichlari, bolalar va o'smirlarda antropometrik o'lchovlar olib borish va baholash.",
      "Salomatlik guruhlari. Bolalarni salomatligidagi siljishlarni baxolash.",
      "Mehnat gigiyenasi fani haqida tushuncha. Mehnat gigiyenasi bo'limi tekshiruv ob'ektlari haqida tushuncha.",
      "Mehnat gigiyenasi bo'limlarini yuritiluvchi xujjatlari, mehnat gigiyenasida salbiy ta'sir etuvchi omillar.",
      "Ish joylarida shovqin va tebranishni aniqlashning metodik asoslari",
      "Kasb kasallilklari va uning profilaktikasi.",
      "Radiatsion gigiyena fani haqida tushuncha. Radiologik bo'limning tekshiruv ob'ektlari haqida tushuncha. Dozimetrik va radiometrik nazorat o'lchash usullari",
    ],
  },
  2448: {
    'name': 'Tibbiy profilaktika ishi 2023-2024 (Milliy) 6-semestr Ovqatlanish gigiyenasi',
    'file': "OG_Kalendar_tematika_Amaliy_mashg'ulot_3_kurs_6_semestr_2.doc",
    'lectures': [
      "Nutritsiologiya va ovqatlanish gigiyenasi fani haqida asosiy tushunchalar, Ovqatlanish gigiyenasi fanining tarixi.",
      "Ovqatlanish nazariyalari.",
      "Sog'lom ovqatlanish me'zonlari",
      "Ratsional va mutanosib ovqatlanish.",
    ],
    'practicals': [
      "Ovqatlanish gigiyenasi fanini o'qitishning maqsadi, vazifalari va asosiy tushunchalari",
      "Aholining ovqatlanishini o'rganish usullari",
      "Kunlik energetik sarfini adekvatligini aniqlash",
      "Ovqatni energetik adekvatligini taxlil qilish",
      "Asosiy modda almashinuvi, ovqat hazm qilish va quvvatni aniqlash",
      "Organizmni oziq moddalarga bo'lgan ehtiyojini aniqlash",
      "Parhez ovqatlanish haqida tushuncha",
      "Profilaktik ratsionlar va ularning ahamiyati",
      "Ozuqaviy qiymati yuqori mahsulotlarning ahamiyati",
    ],
  },
  2445: {
    'name': 'Tibbiy profilaktika ishi 2022-2023 (Milliy) 7-semestr Ovqatlanish gigiyenasi',
    'file': "OG_Kalendar_tematika_Maruza,_Amaliy_mashg'ulot_4_kurs_7_semestr.doc",
    'lectures': ["Oqsillarning ovqatlanishdagi ahamiyati.", "Yog'larning ovqatlanishdagi ahamiyati.", "Karbonsuvlarning ovqatlanishdagi ahamiyati", "Vitaminlarning ovqatlanishdagi ahamiyati"],
    'practicals': ["Oziq-ovqat mahsulotlarining tibbiy-biologik talabalari.", "Oziq-ovqat mahsulotlarining gigiyenik tekshirish ekspertizasi.", "Don va un mahsulotlarini sanitar-gigiyenik ekspertizasi.", "Un va non mahsulotlarini sanitar gigiyenik ekspertizasi.", "Sut mahsulotlarini gigiyenik tekshirish.", "Go'sht mahsulotlarini gigiyenik tekshirish.", "Go'sht mahsulotlarini gigiyenik tekshirish"],
  },
  2447: {
    'name': 'Tibbiy profilaktika ishi 2022-2023 (Milliy) 8-semestr Ovqatlanish gigiyenasi',
    'file': "OG_Kalendar_tematika_Maruza,_Amaliy_mashg'ulot_4_kurs_8_semestr.doc",
    'lectures': ["Mineral elementlarning ovqatlanishdagi ahamiyati", "Sut va sut maxsulotlarining aholi ovqatlanishidagi ahamiyati", "Go'sht mahsulotlarini, ularni ovqatlanishdagi ahamiyati"],
    'practicals': ["Kolbasa mahsulotlarini gigiyenik tekshirish.", "Konserva mahsulotlarini gigiyenik tekshirish.", "Yaxna ichimliklarni gigiyenik tekshirish", "Baliq mahsulotlarini gigiyenik tekshirish"],
  },
  2444: {
    'name': "Tibbiy profilaktika ishi 2022-2023 (Milliy) 6-semestr Bolalar va o'smirlar gigiyenasi",
    'file': "bo'g_Kalendar_tematika_Amaliy_mashg'ulot_3_kurs_6_semestr.doc",
    'lectures': ["Bolalar va o'smirlar gigiyenasi moduli va vazifalari. Bolalar va o'smirlar gigiyenasi modulining o'quv va ilmiy modul sifatida rivojlanish tarixi.", "O'suvchi organizm o'sish va rivojlanishining asosiy qonuniyatlari.", "Kasallanish, uning bolalar orasida yosh xususiyatlari bo'yicha tarkibi.", "Bolalar va o'smirlar jismoniy rivojlanish tartibi. Akseleratsiya va uning nazariyasi"],
    'practicals': ["Bolalar va o'smirlar salomatlik holatini xarakterlovchi ko'rsatkichlarni baholash usullari", "Antropometrik tekshirish usullari, o'smirlarning jismoniy rivojlanish standartlarini ishlab chiqish", "Maktabgacha ta'lim tashkilotlari loyhasiga sanitar gigenik baho berish.", "MTTlar yer maydoni, havo-issiqlik almashinuvi, yoritilganlik tartibini baholash.", "MTTlarda yoritilganlik tartibini baholash.", "MTT jihozlari va ularni joylashtirishga gigiyenik baho berish.", "Bolalar o'yinchoqlariga gigiyenik baho borish", "Bolalar kiyimlariga gigiyenik baho berish.", "Maktabgacha tarbiya yoshidagi bolalar ovqatlanishini gigiyenik baholash."],
  },
  2436: {
    'name': "Bolalar va o'smirlar gigiyenasi 7-s TPI",
    'file': "BO'G 3-4 kurs TEMATIK REJALAR  2026-2027.doc",
    'lectures': ["Maktabgacha ta'lim tashkilotlarini loyihalashtirish va qurishning gigiyenik talablari.", "Umumta'lim maktablarini loyihalashtirish va qurishning gigiyenik talablari.", "O'zbekiston sharoitida maktablarda havo-issiqlik almashinuvi va yoritilganligiga bo'lgan gigiyenik talablar.", "Maktabda o'quv jarayonini gigiyenik asoslari."],
    'practicals': ["Umumta'lim maktablari loyihasini sanitar-gigiyenik ekspertiza qilish.", "Umumta'lim maktablari yer maydoni, havo-issiqlik almashinuvi, yoritilganlik tartibini baholash.", "Umumta'lim maktablari jihozlari va ularni joylashtirishga gigiyenik baho berish.", "Umumta'lim maktablari darsliklarini gigiyenik baholash usullari.", "Umumta'lim maktablarida o'quv jarayonini gigiyenik baholash usullari.", "Maktab yoshidagi bolalar va o'smirlar ovqatlanishining gigiyenik asoslari."],
  },
  2446: {
    'name': "Tibbiy profilaktika ishi 2022-2023 (Milliy) 8-semestr Bolalar va o'smirlar gigiyenasi",
    'file': "BO'G 3-4 kurs TEMATIK REJALAR  2026-2027.doc",
    'lectures': ["Maktab jixozlariga bo'lgan asosiy gigiyenik talablar.", "Bolalar va o'smirlar kontingentlarini mehnat va kasbiy ta'limiga o'rgatishning gigiyenik asoslari. O'smirlarni kasbga yo'naltirishning gigiyenik asoslari", "Rivojlanishida nuqsoni bo'lgan va surunkali kasalliklarga chalingan bolalar muassasalarini loyhalashtirish va qurishning gigiyenik asoslari"],
    'practicals': ["Akademik litseylar loyihasini sanitar-gigiyenik ekspertiza qilish.", "Kasbiy maktablar loyihasini sanitar-gigiyenik ekspertiza qilish.", "Kasbiy maktablar jihozlari va ularni joylashtirishga gigiyenik baho berish.", "Kasbiy maslaxat olib borish va o'smirlarni kasbga yaroqliligini aniqlash usullari."],
  },
}

db=SessionLocal()
try:
    ids=list(COURSES)
    old=[]
    for obj in db.execute(select(CourseSyllabus).where(CourseSyllabus.id.in_(ids))).scalars():
        old.append({
            'id': obj.id,
            'subject_name': obj.subject_name,
            'subject_code': obj.subject_code,
            'department_id': obj.department_id,
            'direction_code': obj.direction_code,
            'file_name': obj.file_name,
            'topics': obj.topics,
            'variants': obj.variants,
        })
    BACKUP_PATH.write_text(json.dumps(old, ensure_ascii=False, indent=2), encoding='utf-8')
    now=dt.datetime.now(dt.timezone.utc)
    for sid, data in COURSES.items():
        obj=db.get(CourseSyllabus, sid)
        if obj is None:
            raise RuntimeError(f'CourseSyllabus {sid} topilmadi')
        topic_rows=make_topics(data['lectures'], data['practicals'])
        obj.subject_name=data['name']
        obj.department_id=DEPT_ID
        obj.direction_code='TPI'
        obj.description='2026/2027 o‘quv yili kalendar-tematik reja asosida yangilandi.'
        obj.instruction_language='uz'
        obj.file_name=data['file']
        obj.topics=topic_rows
        obj.variants=[{'label':'asosiy', 'topics': topic_rows, 'file_name': data['file']}]
        obj.is_active=True
        obj.updated_at=now
    db.commit()
    for sid in ids:
        obj=db.get(CourseSyllabus,sid)
        lectures=sum(1 for x in obj.topics if x.get('type')=='lecture')
        practicals=sum(1 for x in obj.topics if x.get('type')=='practical')
        print(f'{obj.id}|{obj.subject_name}|{len(obj.topics)}|{lectures}|{practicals}|{obj.file_name}')
    print('BACKUP', BACKUP_PATH)
finally:
    db.close()
