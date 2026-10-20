import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader2, X } from 'lucide-react';
import { HttpError } from '../../api/httpClient';
import { fetchStaffDetail, type StaffDetail } from '../../utils/staffMergeApi';

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('uz-UZ', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const SOURCE_LABEL: Record<string, string> = {
  face: 'yuz orqali',
  name: 'ism-familiya bo\'yicha',
  admin: 'admin qo\'lda',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 text-[13px]">
      <div className="w-44 shrink-0 text-black/50">{label}</div>
      <div className="min-w-0 flex-1 text-black/85 break-words">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-black/10 bg-white/70 px-4 py-3">
      <h3 className="text-[12px] font-bold uppercase tracking-wide text-black/45 mb-1">{title}</h3>
      {children}
    </section>
  );
}

/** Bitta xodimning to'liq ma'lumoti: hisob, profil, cam.fermi.uz dagi shaxsi, JSHSHIR, yuz, faollik. */
export default function AdminStaffDetail({ username, onClose }: { username: string; onClose: () => void }) {
  const [data, setData] = useState<StaffDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    fetchStaffDetail(username)
      .then((d) => alive && setData(d))
      .catch((err) => {
        if (!alive) return;
        const detail = err instanceof HttpError ? (err.body as { detail?: unknown } | null)?.detail : null;
        setError(typeof detail === 'string' ? detail : "Ma'lumotni yuklab bo'lmadi.");
      });
    return () => {
      alive = false;
    };
  }, [username]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-[#f7f7fa] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/10 sticky top-0 bg-[#f7f7fa]">
          <h2 className="text-lg font-bold text-black/90">
            {data ? `${data.account.last_name} ${data.account.first_name}`.trim() : "Xodim ma'lumoti"}
          </h2>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-black/5" aria-label="Yopish">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {error ? (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
              <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
            </div>
          ) : null}
          {!data && !error ? (
            <div className="py-10 text-center text-black/45">
              <Loader2 className="animate-spin inline mr-2" size={18} /> Yuklanmoqda…
            </div>
          ) : null}

          {data ? (
            <>
              <Section title="Hisob">
                <Row label="Login">
                  <span className="font-mono">{data.account.login_kind === 'phone' ? `+${data.account.username}` : data.account.username}</span>{' '}
                  <span className="text-black/45">({data.account.login_kind === 'phone' ? 'telefon' : 'Xodim ID'})</span>
                </Row>
                <Row label="Rol">{data.account.role || '—'}</Row>
                <Row label="Holat">
                  {data.account.is_active ? 'Faol' : <span className="text-rose-600 font-semibold">Nofaol</span>}
                </Row>
                <Row label="Ro'yxatdan o'tgan">{fmt(data.account.date_joined)}</Row>
                <Row label="Oxirgi kirish">
                  {fmt(data.account.last_login)}
                  {data.account.password_is_initial ? <span className="text-amber-700"> · hali kirmagan (boshlang'ich parol)</span> : null}
                </Row>
              </Section>

              <Section title="JSHSHIR va cam.fermi.uz">
                <Row label="JSHSHIR">
                  {data.pinfl ? (
                    <>
                      <span className="font-mono">{data.pinfl.pinfl}</span>{' '}
                      <span className="text-black/45">({SOURCE_LABEL[data.pinfl.source] ?? data.pinfl.source})</span>
                    </>
                  ) : (
                    <span className="text-amber-700 font-semibold">bog'lanmagan — JSHSHIR bilan kira olmaydi</span>
                  )}
                </Row>
                {data.cam_fermi ? (
                  <>
                    <Row label="To'liq F.I.Sh.">{data.cam_fermi.full_name}</Row>
                    <Row label="Pasport">{data.cam_fermi.passport || '—'}</Row>
                    <Row label="HEMIS ID">{data.cam_fermi.hemis_id || '—'}</Row>
                    <Row label="Oxirgi sinxronlash">{fmt(data.cam_fermi.synced_at)}</Row>
                  </>
                ) : data.pinfl ? (
                  <Row label="cam.fermi.uz">shaxs yozuvi topilmadi</Row>
                ) : null}
                <Row label="Yuz shablonlari">
                  {data.face.templates > 0 ? `${data.face.templates} ta` : "yo'q — yuz bilan kira olmaydi"}
                  {data.face.positions.length ? <span className="text-black/45"> · {data.face.positions.join(', ')}</span> : null}
                </Row>
              </Section>

              <Section title="Profil">
                {data.profile ? (
                  <>
                    <Row label="Kafedra">{data.profile.department || '—'}</Row>
                    <Row label="Fakultet">{data.profile.faculty || '—'}</Row>
                    <Row label="Yo'nalish">{data.profile.direction || '—'}</Row>
                    <Row label="Lavozim">{data.profile.job_title || '—'}</Row>
                    <Row label="HEMIS holati">{data.profile.hemis_status || '—'}</Row>
                    <Row label="Rasm">{data.profile.has_photo ? 'yuklangan' : "yo'q"}</Row>
                  </>
                ) : (
                  <Row label="Profil">to'ldirilmagan</Row>
                )}
              </Section>

              <Section title="Faollik">
                <Row label="Tanlangan fanlar">{data.activity.courses}</Row>
                <Row label="Tayyor kontent">{data.activity.prepared_content}</Row>
              </Section>

              {data.duplicates.length ? (
                <Section title="Ehtimoliy takror hisoblar">
                  {data.duplicates.map((d) => (
                    <Row key={d.username} label={d.display_name}>
                      <span className="font-mono">{d.username}</span>
                      <span className="text-black/45"> · JSHSHIR: {d.pinfl || "yo'q"} · fan/kontent: {d.activity}</span>
                    </Row>
                  ))}
                  <p className="text-[12px] text-black/50 pt-1">
                    Birlashtirish: "O'qituvchilarni birlashtirish" bo'limida.
                  </p>
                </Section>
              ) : null}

              {data.merge_history.length ? (
                <Section title="Birlashtirish tarixi">
                  {data.merge_history.map((h, i) => (
                    <Row key={i} label={fmt(h.merged_at)}>
                      <span className="font-mono">{h.merged}</span> → <span className="font-mono">{h.primary}</span>
                      <span className="text-black/45"> · {h.actor}</span>
                    </Row>
                  ))}
                </Section>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
