/**
 * O'zbekiston fuqarosi pasportining seriyalari — kirish oynasidagi tanlov.
 *
 * Seriya ro'yxatdan tanlanadi, qo'lda yozilmaydi: manbadagi yozuvlarda
 * kirillcha "А" bilan lotincha "A" aralash kelgan va qo'lda yozilganda
 * hech kim topilmasdi.
 *
 * Serverdagi ro'yxat bilan bir xil bo'lishi kerak:
 * `backend_fastapi/app/services/person_identity.py` → `SERIES_CHOICES`.
 */
export const PASSPORT_SERIES: readonly string[] = [
  'AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AK', 'AL',
  'AM', 'AN', 'AO', 'AP', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AV', 'AX', 'AY',
  'AZ', 'ID',
];
