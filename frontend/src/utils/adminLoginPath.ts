/**
 * Administrator uchun alohida kirish manzili: `imentor.uz/admin`.
 *
 * Kompyuterda login va parol bilan kirish OLIB TASHLANDI — xodim faqat QR
 * orqali kiradi, chunki kirish telefonda bo'lishi kerak (joylashuv shu yerda
 * qayd etiladi). Lekin administratorning telefoni bilan bog'langan xodim
 * hisobi yo'q va u QR bilan kira olmaydi, shuning uchun unga alohida manzil
 * qoldirildi: faqat shu sahifada parol oynasi ochiladi.
 *
 * `/rektor` kabi — ilova bo'limi emas, alohida kirish nuqtasi.
 */
export function isAdminLoginPath(): boolean {
  try {
    const path = window.location.pathname.replace(/\/+$/, '').toLowerCase();
    return path === '/admin' || path === '/admin-login';
  } catch {
    return false;
  }
}
