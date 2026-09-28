/**
 * O'qituvchi sozlamalari matnlari — o'zbek, rus, ingliz (2026-09-24).
 *
 * Umumiy `translations.ts` ga 90 ta kalit qo'shmaslik uchun shu sahifaning
 * o'z lug'ati. Kalitlar o'zbekcha nusxadan olinadi — boshqa tilda kalit
 * tushib qolsa, TypeScript xato beradi.
 */
import { useUiText } from '../../i18n/useUiText';
import type { AppLanguage } from '../../i18n/language';

const uz = {
  pageTitle: 'Profil va sozlamalar',
  pageSubtitle: 'Kerakli bo‘limni tanlang — har birining yonida qanday qilinishi yozilgan.',
  navAria: 'Sozlamalar bo‘limlari',
  howTo: 'Qanday qilinadi',

  tabProfile: 'Profil',
  tabProfileHint: 'Ism, lavozim, kafedra, rasm, parol',
  tabSubjects: 'Fanlarim',
  tabSubjectsHint: 'Fan tanlash, Excel yoki Word’dan yuklash',
  tabLibrary: 'Kafedra kutubxonasi',
  tabLibraryHint: 'Darslik va protokollar — AI uchun',
  tabAccess: 'Kirish va xavfsizlik',
  tabAccessHint: 'Yuz, JSHSHIR, QR',

  profileLoadError: 'Profilni yuklab bo‘lmadi. Sahifani yangilang.',
  nameRequired: 'Ism va familiya bo‘sh bo‘lmasin.',
  deptConfirm:
    'Kafedrani almashtirsangiz, eski kafedradan tanlangan fanlaringiz ro‘yxatdan olinadi. Tayyorlagan materiallaringiz o‘chmaydi. Davom etasizmi?',
  savedDeptChanged: 'Saqlandi. Endi «Fanlarim» bo‘limida yangi kafedra fanlarini tanlang.',
  saved: 'Saqlandi.',
  saveError: 'Saqlab bo‘lmadi. Qayta urinib ko‘ring.',
  workplaceTitle: 'Ism, lavozim va kafedra',
  lastName: 'Familiya',
  firstName: 'Ism',
  jobTitle: 'Lavozim',
  jobTitlePlaceholder: 'Masalan: katta o‘qituvchi, assistent',
  department: 'Kafedra',
  choose: '— tanlang —',
  deptChangeInfo:
    'Kafedra almashsa, eski kafedra fanlaridan tanlov olinadi — yangi kafedra fanlarini «Fanlarim»da qayta tanlaysiz. Tayyorlagan ma’ruza, test va keyslaringiz o‘chmaydi.',
  save: 'Saqlash',
  loginFixed: 'o‘zgarmaydi',
  profileIntro: 'Rektor hisoboti va fanlar ro‘yxati shu ma’lumotlarga qarab ishlaydi.',
  profileStep1: 'Familiya, ism, lavozim va kafedrangizni tekshiring, kerak bo‘lsa to‘g‘rilab «Saqlash»ni bosing.',
  profileStep2: 'Rasmni pastdagi kartochkada almashtiring (JPG yoki PNG, yuz aniq ko‘rinsin).',
  profileStep3: 'Parolni shu sahifaning pastida almashtirasiz.',
  profileNote: 'Login (telefon yoki Xodim ID) o‘zgarmaydi — u sizning hisobingiz kaliti.',

  subjectsIntro: 'O‘tadigan fanlaringizni tanlang yoki o‘z faningizni Excel yoki Word’dan yuklang.',
  subjectsStep1:
    'Pastdagi ro‘yxatdan o‘zingiz o‘tadigan fanlarni belgilab «Saqlash»ni bosing. Xorijiy guruhlar fanlari «Xalqaro» bo‘limida.',
  subjectsStep2: 'Faningiz ro‘yxatda yo‘q yoki mavzulari eskirgan bo‘lsa — namuna Excel faylni yuklab oling va to‘ldiring.',
  subjectsStep3:
    'To‘ldirilgan faylni «Fayldan fan yuklash» orqali yuklang (ishchi dastur yoki kalendar reja Word (.docx) fayli ham bo‘ladi): fan faqat sizga ko‘rinadi va darhol ishlatiladi.',
  subjectsNote:
    'Excel’da har qatorda bitta mavzu: «Nomi», «Mashg‘ulot» (Ma’ruza, Amaliy, Klinik, Laboratoriya, Mustaqil ta’lim), «Yuklama» (soat).',
  ownUploadTitle: 'O‘z fanimni fayldan yuklash (Excel yoki Word)',
  ownUploadHint: 'Kafedra tematik rejasi bo‘yicha — bu yilgi mavzular bilan.',
  templateFile: 'Namuna fayl',
  uploadFromFile: 'Fayldan fan yuklash',
  subjectAdded: 'Fan qo‘shildi va ro‘yxatingizga biriktirildi. «Mening fanlarim» sahifasida ko‘rinadi.',
  mySubjects: 'O‘tadigan fanlarim',

  statusReady: 'Tayyor — AI foydalanadi',
  statusProcessing: 'Indekslanmoqda…',
  statusFailed: 'Xato',
  libraryLoadError: 'Kutubxonani yuklab bo‘lmadi.',
  uploaded: 'Yuklandi. Matn fonda o‘qilib, bir necha daqiqada AI uchun tayyor bo‘ladi.',
  uploadError: 'Yuklab bo‘lmadi. Qayta urinib ko‘ring.',
  deleteConfirm: '«{title}» o‘chirilsinmi? AI endi undan foydalanmaydi.',
  deleteError: 'O‘chirib bo‘lmadi.',
  protocolsGroup: 'Protokollar (majburiy manba)',
  booksGroup: 'Darslik va qo‘llanmalar',
  libraryIntro: 'Yuklagan hujjatingizga AI kafedrangiz fanlarida tayanadi.',
  libraryStep1: 'Turini tanlang: «Darslik / qo‘llanma» yoki «Protokol» (milliy klinik protokol, SanPin, SSV buyrug‘i).',
  libraryStep2: 'PDF, Word (.docx, .doc) yoki .txt faylni tanlang va «Yuklash»ni bosing (40 MB gacha).',
  libraryStep3:
    'Bir necha daqiqadan keyin holati «Tayyor» bo‘ladi — shundan so‘ng AI kafedrangiz fanlarida ma’ruza, test va keys tayyorlaganda shu hujjatga tayanadi.',
  libraryNote:
    'Protokol darslikdan ustun turadi: ziddiyat bo‘lsa, AI protokolga amal qiladi. Skanerlangan (rasm ko‘rinishidagi) PDF o‘qilmaydi — matnli nusxasini yuklang. Hujjat butun kafedraga xizmat qiladi; o‘chirishni faqat yuklagan o‘qituvchi yoki admin qila oladi.',
  uploadDoc: 'Hujjat yuklash',
  kindBook: 'Darslik / qo‘llanma',
  kindProtocol: 'Protokol',
  titlePlaceholder: 'Nomi (ixtiyoriy — bo‘sh qolsa fayl nomi olinadi)',
  chooseFile: 'Fayl tanlash',
  fileHint: 'PDF, Word yoki .txt — 40 MB gacha',
  upload: 'Yuklash',
  none: 'Hozircha yo‘q.',
  delete: 'O‘chirish',

  accessIntro: 'Tizimga qaysi yo‘llar bilan kira olishingiz.',
  accessStep1:
    'Telefonda yuz orqali kirish uchun yuzingizni cam.fermi.uz saytida ro‘yxatdan o‘tkazing — tasdiqlangach bir soat ichida iMentor’da ishlaydi.',
  accessStep2: 'Kompyuterda kirish: ekrandagi QR kodni telefoningizdagi iMentor bilan skanerlang.',
  accessStep3: 'Login-parol bilan kirishda login o‘rniga JSHSHIR (14 raqam), Xodim ID yoki telefon yozishingiz mumkin.',
  faceTitle: 'Yuz orqali kirish',
  faceLinked: 'Yuzingiz hisobingizga bog‘langan',
  faceNotLinked: 'Hali bog‘lanmagan',
  faceRegister: 'cam.fermi.uz’da ro‘yxatdan o‘tish',
  pinflTitle: 'JSHSHIR bilan kirish',
  pinflLinked: 'JSHSHIR hisobingizga bog‘langan — u bilan kira olasiz',
  pinflNotLinked: 'JSHSHIR hali bog‘lanmagan. Yuzingizni cam.fermi.uz’da ro‘yxatdan o‘tkazsangiz, avtomatik bog‘lanadi.',
  pinflPassword: 'Parol — hozirgi parolingiz. Parolni «Profil» bo‘limining pastida almashtirasiz.',
};

export type SettingsText = typeof uz;

const ru: SettingsText = {
  pageTitle: 'Профиль и настройки',
  pageSubtitle: 'Выберите раздел — рядом с каждым написано, как это сделать.',
  navAria: 'Разделы настроек',
  howTo: 'Как это сделать',

  tabProfile: 'Профиль',
  tabProfileHint: 'Имя, должность, кафедра, фото, пароль',
  tabSubjects: 'Мои предметы',
  tabSubjectsHint: 'Выбор предметов, загрузка из Excel или Word',
  tabLibrary: 'Библиотека кафедры',
  tabLibraryHint: 'Учебники и протоколы — для ИИ',
  tabAccess: 'Вход и безопасность',
  tabAccessHint: 'Лицо, ПИНФЛ, QR',

  profileLoadError: 'Не удалось загрузить профиль. Обновите страницу.',
  nameRequired: 'Имя и фамилия не должны быть пустыми.',
  deptConfirm:
    'При смене кафедры предметы, выбранные на старой кафедре, будут сняты. Подготовленные материалы не удалятся. Продолжить?',
  savedDeptChanged: 'Сохранено. Теперь выберите предметы новой кафедры в разделе «Мои предметы».',
  saved: 'Сохранено.',
  saveError: 'Не удалось сохранить. Попробуйте ещё раз.',
  workplaceTitle: 'Имя, должность и кафедра',
  lastName: 'Фамилия',
  firstName: 'Имя',
  jobTitle: 'Должность',
  jobTitlePlaceholder: 'Например: старший преподаватель, ассистент',
  department: 'Кафедра',
  choose: '— выберите —',
  deptChangeInfo:
    'При смене кафедры выбор предметов старой кафедры снимается — предметы новой кафедры выберите заново в «Моих предметах». Лекции, тесты и кейсы не удалятся.',
  save: 'Сохранить',
  loginFixed: 'не меняется',
  profileIntro: 'Отчёт ректора и список предметов опираются на эти данные.',
  profileStep1: 'Проверьте фамилию, имя, должность и кафедру; при необходимости исправьте и нажмите «Сохранить».',
  profileStep2: 'Фото меняется в карточке ниже (JPG или PNG, лицо должно быть хорошо видно).',
  profileStep3: 'Пароль меняется внизу этой страницы.',
  profileNote: 'Логин (телефон или ID сотрудника) не меняется — это ключ вашей учётной записи.',

  subjectsIntro: 'Выберите свои предметы или загрузите собственный предмет из Excel или Word.',
  subjectsStep1:
    'Отметьте в списке ниже предметы, которые вы ведёте, и нажмите «Сохранить». Предметы иностранных групп — в разделе «Международный».',
  subjectsStep2: 'Если предмета нет в списке или темы устарели — скачайте шаблон Excel и заполните его.',
  subjectsStep3:
    'Загрузите заполненный файл через «Загрузить предмет из файла» (подойдёт и рабочая программа или календарный план в Word .docx): предмет виден только вам и сразу доступен.',
  subjectsNote:
    'В Excel — одна тема в строке: «Название», «Занятие» (Лекция, Практика, Клиническое, Лабораторная, Самостоятельная работа), «Часы».',
  ownUploadTitle: 'Загрузить свой предмет из файла (Excel или Word)',
  ownUploadHint: 'По тематическому плану кафедры — с темами этого года.',
  templateFile: 'Шаблон',
  uploadFromFile: 'Загрузить предмет из файла',
  subjectAdded: 'Предмет добавлен и закреплён за вами. Он появится на странице «Мои предметы».',
  mySubjects: 'Предметы, которые я веду',

  statusReady: 'Готово — используется ИИ',
  statusProcessing: 'Индексируется…',
  statusFailed: 'Ошибка',
  libraryLoadError: 'Не удалось загрузить библиотеку.',
  uploaded: 'Загружено. Текст обрабатывается в фоне и через несколько минут будет готов для ИИ.',
  uploadError: 'Не удалось загрузить. Попробуйте ещё раз.',
  deleteConfirm: 'Удалить «{title}»? ИИ больше не будет его использовать.',
  deleteError: 'Не удалось удалить.',
  protocolsGroup: 'Протоколы (обязательный источник)',
  booksGroup: 'Учебники и пособия',
  libraryIntro: 'ИИ опирается на загруженные документы при работе с предметами вашей кафедры.',
  libraryStep1: 'Выберите тип: «Учебник / пособие» или «Протокол» (национальный клинический протокол, СанПиН, приказ МЗ).',
  libraryStep2: 'Выберите PDF, Word (.docx, .doc) или .txt и нажмите «Загрузить» (до 40 МБ).',
  libraryStep3:
    'Через несколько минут статус станет «Готово» — после этого ИИ опирается на документ при подготовке лекций, тестов и кейсов по предметам кафедры.',
  libraryNote:
    'Протокол важнее учебника: при противоречии ИИ следует протоколу. Сканированный PDF (картинкой) не читается — загрузите текстовую версию. Документ служит всей кафедре; удалить его может только загрузивший преподаватель или администратор.',
  uploadDoc: 'Загрузка документа',
  kindBook: 'Учебник / пособие',
  kindProtocol: 'Протокол',
  titlePlaceholder: 'Название (необязательно — иначе возьмётся имя файла)',
  chooseFile: 'Выбрать файл',
  fileHint: 'PDF, Word или .txt — до 40 МБ',
  upload: 'Загрузить',
  none: 'Пока нет.',
  delete: 'Удалить',

  accessIntro: 'Какими способами вы можете войти в систему.',
  accessStep1:
    'Для входа по лицу на телефоне зарегистрируйте лицо на сайте cam.fermi.uz — после подтверждения вход в iMentor заработает в течение часа.',
  accessStep2: 'Вход на компьютере: отсканируйте QR-код на экране приложением iMentor на телефоне.',
  accessStep3: 'При входе по логину и паролю вместо логина можно ввести ПИНФЛ (14 цифр), ID сотрудника или телефон.',
  faceTitle: 'Вход по лицу',
  faceLinked: 'Лицо привязано к вашей учётной записи',
  faceNotLinked: 'Ещё не привязано',
  faceRegister: 'Регистрация на cam.fermi.uz',
  pinflTitle: 'Вход по ПИНФЛ',
  pinflLinked: 'ПИНФЛ привязан к учётной записи — можно входить с ним',
  pinflNotLinked: 'ПИНФЛ ещё не привязан. Он привяжется автоматически после регистрации лица на cam.fermi.uz.',
  pinflPassword: 'Пароль — ваш текущий пароль. Сменить его можно внизу раздела «Профиль».',
};

const en: SettingsText = {
  pageTitle: 'Profile and settings',
  pageSubtitle: 'Pick a section — each one explains how to do it.',
  navAria: 'Settings sections',
  howTo: 'How to',

  tabProfile: 'Profile',
  tabProfileHint: 'Name, job title, department, photo, password',
  tabSubjects: 'My courses',
  tabSubjectsHint: 'Choose courses, upload from Excel or Word',
  tabLibrary: 'Department library',
  tabLibraryHint: 'Textbooks and protocols for AI',
  tabAccess: 'Sign-in and security',
  tabAccessHint: 'Face, PINFL, QR',

  profileLoadError: 'Could not load your profile. Refresh the page.',
  nameRequired: 'First and last name must not be empty.',
  deptConfirm:
    'If you change department, the courses you chose in the old department are removed from your list. Your materials are kept. Continue?',
  savedDeptChanged: 'Saved. Now choose your new department’s courses in “My courses”.',
  saved: 'Saved.',
  saveError: 'Could not save. Please try again.',
  workplaceTitle: 'Name, job title and department',
  lastName: 'Last name',
  firstName: 'First name',
  jobTitle: 'Job title',
  jobTitlePlaceholder: 'e.g. senior lecturer, assistant',
  department: 'Department',
  choose: '— choose —',
  deptChangeInfo:
    'Changing department clears your course choices from the old department — choose the new department’s courses again in “My courses”. Your lectures, tests and cases are kept.',
  save: 'Save',
  loginFixed: 'cannot be changed',
  profileIntro: 'The rector’s report and your course list rely on this information.',
  profileStep1: 'Check your last name, first name, job title and department; fix them if needed and press “Save”.',
  profileStep2: 'Change your photo in the card below (JPG or PNG, face clearly visible).',
  profileStep3: 'Change your password at the bottom of this page.',
  profileNote: 'Your login (phone or staff ID) does not change — it is the key to your account.',

  subjectsIntro: 'Choose the courses you teach or upload your own course from Excel or Word.',
  subjectsStep1:
    'Tick the courses you teach in the list below and press “Save”. Courses for international groups are under “International”.',
  subjectsStep2: 'If your course is missing or its topics are outdated, download the Excel template and fill it in.',
  subjectsStep3:
    'Upload the filled-in file with “Upload course from file” (a working programme or calendar plan in Word .docx also works): the course is visible only to you and ready at once.',
  subjectsNote:
    'In Excel, one topic per row: “Title”, “Session” (Lecture, Practical, Clinical, Lab, Independent study), “Hours”.',
  ownUploadTitle: 'Upload my own course from a file (Excel or Word)',
  ownUploadHint: 'Following the department’s thematic plan — with this year’s topics.',
  templateFile: 'Template',
  uploadFromFile: 'Upload course from file',
  subjectAdded: 'Course added and assigned to you. It appears on the “My courses” page.',
  mySubjects: 'Courses I teach',

  statusReady: 'Ready — used by AI',
  statusProcessing: 'Indexing…',
  statusFailed: 'Failed',
  libraryLoadError: 'Could not load the library.',
  uploaded: 'Uploaded. The text is processed in the background and will be ready for AI in a few minutes.',
  uploadError: 'Could not upload. Please try again.',
  deleteConfirm: 'Delete “{title}”? AI will no longer use it.',
  deleteError: 'Could not delete.',
  protocolsGroup: 'Protocols (mandatory source)',
  booksGroup: 'Textbooks and manuals',
  libraryIntro: 'AI relies on the documents you upload for your department’s courses.',
  libraryStep1: 'Choose the type: “Textbook / manual” or “Protocol” (national clinical protocol, SanPiN, Ministry order).',
  libraryStep2: 'Choose a PDF, Word (.docx, .doc) or .txt file and press “Upload” (up to 40 MB).',
  libraryStep3:
    'In a few minutes the status becomes “Ready” — after that AI relies on the document when preparing lectures, tests and cases for your department’s courses.',
  libraryNote:
    'A protocol outranks a textbook: if they conflict, AI follows the protocol. Scanned (image) PDFs cannot be read — upload a text version. A document serves the whole department; only the uploader or an admin can delete it.',
  uploadDoc: 'Upload a document',
  kindBook: 'Textbook / manual',
  kindProtocol: 'Protocol',
  titlePlaceholder: 'Title (optional — the file name is used if empty)',
  chooseFile: 'Choose file',
  fileHint: 'PDF, Word or .txt — up to 40 MB',
  upload: 'Upload',
  none: 'None yet.',
  delete: 'Delete',

  accessIntro: 'The ways you can sign in.',
  accessStep1:
    'To sign in with your face on a phone, register your face at cam.fermi.uz — once approved it works in iMentor within an hour.',
  accessStep2: 'On a computer: scan the QR code on the screen with iMentor on your phone.',
  accessStep3: 'When signing in with a password, you can type your PINFL (14 digits), staff ID or phone instead of the login.',
  faceTitle: 'Face sign-in',
  faceLinked: 'Your face is linked to your account',
  faceNotLinked: 'Not linked yet',
  faceRegister: 'Register at cam.fermi.uz',
  pinflTitle: 'PINFL sign-in',
  pinflLinked: 'Your PINFL is linked — you can sign in with it',
  pinflNotLinked: 'Your PINFL is not linked yet. It links automatically once your face is registered at cam.fermi.uz.',
  pinflPassword: 'The password is your current password. Change it at the bottom of the “Profile” section.',
};

const TEXTS: Record<AppLanguage, SettingsText> = { uz, ru, en };

export function settingsText(lang: AppLanguage): SettingsText {
  return TEXTS[lang] || uz;
}

export function useSettingsText(): SettingsText {
  const { language } = useUiText();
  return settingsText(language);
}
