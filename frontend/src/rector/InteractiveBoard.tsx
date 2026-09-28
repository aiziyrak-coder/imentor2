import type { BoardInfo } from './intelligenceApi';
export const BOARD_LABELS = {
  available: 'Interaktiv doska mavjud',
  unavailable: 'Interaktiv doska mavjud emas',
  unknown: 'Doska mavjudligi aniqlanmagan',
};
export function InteractiveBoard({ board, full = false }: { board?: BoardInfo; full?: boolean }) {
  const status = board?.status || 'unknown';
  if (!full)
    return (
      <span
        title={board?.reason}
        className={`inline-flex rounded-lg border px-2 py-1 text-xs ${status === 'available' ? 'border-teal-200 bg-teal-50 text-teal-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}
      >
        {BOARD_LABELS[status]}
        {status === 'available' ? ` · ${board?.rooms.length} xona` : ''}
      </span>
    );
  return (
    <section
      aria-label="Dars o‘tish imkoniyati"
      className="rounded-xl border border-slate-200 bg-white p-4 text-sm"
    >
      <p className="font-semibold">{BOARD_LABELS[status]}</p>
      <p className="mt-2 text-slate-600">
        {board?.reason || 'Kafedra va doska ma’lumotlarini aniqlash kerak.'}
      </p>
      {board?.department && (
        <p className="mt-2 text-xs text-slate-500">Jadvaldagi kafedra: {board.department}</p>
      )}
      {!!board?.rooms.length && (
        <details className="mt-2">
          <summary className="cursor-pointer font-medium">
            Doskali auditoriyalar · {board.rooms.length}
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {board.rooms.map((room, i) => (
              <li key={i}>{room}</li>
            ))}
          </ul>
        </details>
      )}
      {!!board?.unavailable_rooms.length && (
        <p className="mt-2 text-xs text-amber-800">
          Ishlaydigan hisobiga kirmaydi: {board.unavailable_rooms.join('; ')}
        </p>
      )}
      {board?.source_url && (
        <p className="mt-3 text-xs text-slate-500">
          <a className="underline" href={board.source_url} target="_blank" rel="noreferrer">
            Interaktiv doskalar jadvali
          </a>{' '}
          · tekshirilgan: {board.checked_on}
          {board.inventory_row ? ` · ${board.inventory_row}-band` : ''}
        </p>
      )}
    </section>
  );
}
