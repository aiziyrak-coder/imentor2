/**
 * pdf.js worker uchun kirish nuqtasi.
 *
 * Worker ichida `Uint8Array.prototype.toHex()` ishlatiladi (PDF barmoq izini
 * hisoblashda). Eskiroq brauzerlarda bu metod yo'q va worker
 *     "hashOriginal.toHex is not a function"
 * xatosi bilan yiqilardi — natijada o'qituvchi taqdimotni ko'ra olmasdi.
 *
 * Import tartibi muhim: polifil MODULI pdf.js worker'idan oldin turadi,
 * shuning uchun u avval baholanadi va metodlar o'rnatiladi.
 */
import './polyfills';
import './uint8ArrayPolyfill.install';
// LEGACY build (2026-09-25): sinflardagi monitorlar Android 9 / Chrome 85 da
// ishlaydi. Oddiy build `Array.prototype.at`, `Promise.withResolvers` kabi
// yangi metodlarni talab qiladi va u yerda "A.at is not a function" bilan
// yiqilardi — o'qituvchi monitorda PDF/taqdimot ocha olmasdi. Legacy build
// shu brauzerlar uchun pdf.js jamoasining o'zi tayyorlagan, polifillari ichida.
import 'pdfjs-dist/legacy/build/pdf.worker.mjs';
