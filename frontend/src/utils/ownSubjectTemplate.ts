/**
 * Fan nomi: sarlavha qatorigacha turgan eng uzun katak (namunada 1-qator
 * "Tibbiy profilaktika ishi 2025-2026 (Milliy) 8-semestr …"). Topilmasa —
 * fayl nomi.
 */
export function subjectNameFromRows(rows: string[][], fileName: string): string {
  for (const row of rows.slice(0, 6)) {
    const cells = row.map((c) => (c || '').trim()).filter(Boolean);
    if (cells.some((c) => /^(nomi|#|№)/i.test(c))) break;
    const longest = cells.sort((a, b) => b.length - a.length)[0];
    if (longest && longest.length >= 4) return longest.replace(/\s+/g, ' ').slice(0, 255);
  }
  return fileName.replace(/\.xlsx?$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 255);
}
