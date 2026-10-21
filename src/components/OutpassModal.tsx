import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Outpass } from '../types';

interface OutpassModalProps {
  outpass: Outpass | null;
  student: { name: string; regNumber: string; department: string; roomNumber: string; block?: string | null };
  onClose: () => void;
  onShowToast: (msg: string, isError?: boolean) => void;
}

const LIFECYCLE_LABEL: Record<string, string> = {
  Active: 'Approved — not yet used',
  Out: 'Checked OUT of campus',
  Completed: 'Returned — pass closed',
  Expired: 'Expired (not used)',
  Cancelled: 'Cancelled',
};

export const OutpassModal: React.FC<OutpassModalProps> = ({ outpass, student, onClose, onShowToast }) => {
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (!outpass?.qrToken) return;
    // Same settings as QrImage: this is the code a gate desk scans off a phone
    // screen, so highest error correction, a full quiet zone and plain black.
    QRCode.toDataURL(outpass.qrToken, { errorCorrectionLevel: 'H', margin: 4, width: 720, color: { dark: '#000000', light: '#FFFFFF' } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [outpass?.qrToken]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!outpass) return null;
  const lifecycle = outpass.lifecycleStatus ?? outpass.status;
  const usable = lifecycle === 'Active' || lifecycle === 'Out';
  const initials = student.name
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const savePass = () => {
    if (!qr) return;
    const a = document.createElement('a');
    a.href = qr;
    a.download = `${outpass.id}-gate-pass.png`;
    a.click();
    onShowToast(`QR for ${outpass.id} saved. The pass is still validated online at the gate.`);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="outpass-title"
        className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden text-slate-800 my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-[var(--kv-nav-bg)] p-5 text-white flex items-center justify-between relative overflow-hidden">
          <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-white/5 rounded-full blur-xl pointer-events-none" />
          <div>
            <div className="flex items-center gap-2">
              <span id="outpass-title" className="font-extrabold text-base tracking-wider">KVCET</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-white/20 text-blue-100 uppercase tracking-widest">DIGITAL GATE PASS</span>
            </div>
            <p className="text-xs text-blue-200/90 mt-0.5">Karpaga Vinayaga College of Engineering & Technology</p>
          </div>
          <button onClick={onClose} aria-label="Close pass" className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors cursor-pointer" type="button">
            ✕
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-xl bg-[var(--kv-nav-bg)] text-white flex items-center justify-center font-bold text-base shadow-sm shrink-0">{initials}</div>
              <div className="min-w-0">
                <h3 className="font-bold text-sm text-slate-900 truncate">{student.name}</h3>
                <p className="text-xs text-slate-500 font-mono">
                  Reg: {student.regNumber} · {student.department}
                </p>
                <p className="text-xs text-[var(--kv-primary)] font-medium">
                  {student.block ? `${student.block} · ` : ''}Room {student.roomNumber}
                </p>
              </div>
            </div>
            <div className="text-right shrink-0">
              <span
                className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                  usable ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-slate-100 text-slate-700'
                }`}
              >
                {lifecycle}
              </span>
              <p className="text-[11px] font-mono font-bold text-slate-400 mt-1">{outpass.id}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-4 rounded-xl border border-slate-100">
            <div>
              <span className="text-slate-400 font-semibold uppercase tracking-wider block text-[10px]">Pass Type</span>
              <span className="font-bold text-slate-800 text-sm mt-0.5 block">{outpass.type} Pass</span>
              <span className="text-[11px] text-slate-500">{outpass.title}</span>
            </div>
            <div>
              <span className="text-slate-400 font-semibold uppercase tracking-wider block text-[10px]">Valid Duration / Slot</span>
              <span className="font-bold text-slate-800 text-sm mt-0.5 block">{outpass.dateRange}</span>
              {outpass.timeSlot && <span className="text-[11px] text-slate-500">{outpass.timeSlot}</span>}
            </div>
            <div className="col-span-2 pt-2 border-t border-slate-200/60">
              <span className="text-slate-400 font-semibold uppercase tracking-wider block text-[10px]">Approvals</span>
              <span className="text-[11px] text-emerald-700 font-semibold mt-0.5 block">✓ {outpass.approvals}</span>
              {outpass.remarks && <span className="text-[11px] text-slate-600 block mt-1">{outpass.remarks}</span>}
            </div>
            {(outpass.gateCheckOutTime || outpass.gateCheckInTime) && (
              <div className="col-span-2 pt-2 border-t border-slate-200/60 grid grid-cols-2 gap-2">
                <div>
                  <span className="text-slate-400 font-semibold uppercase tracking-wider block text-[10px]">Checked out</span>
                  <span className="font-medium text-slate-700">{outpass.gateCheckOutTime ?? '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-semibold uppercase tracking-wider block text-[10px]">Checked in</span>
                  <span className="font-medium text-slate-700">{outpass.gateCheckInTime ?? '—'}</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col items-center justify-center p-4 bg-white border border-slate-200 rounded-xl space-y-2">
            {usable && qr ? (
              <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm flex flex-col items-center">
                <img src={qr} alt={`QR code for gate pass ${outpass.id}`} className="w-40 h-40" />
                <span className="text-[10px] font-mono text-slate-500 font-semibold tracking-wider mt-1 break-all text-center">{outpass.qrToken}</span>
              </div>
            ) : (
              <p className="text-xs text-slate-500 py-6">{usable ? 'Generating QR code…' : 'This pass can no longer be used at the gate.'}</p>
            )}
            <div className="flex items-center gap-2 text-xs" role="status">
              <span className={`w-2.5 h-2.5 rounded-full ${lifecycle === 'Out' ? 'bg-amber-500' : usable ? 'bg-emerald-500' : 'bg-slate-400'}`} aria-hidden="true" />
              <span className="font-semibold text-slate-700">Gate Status: {LIFECYCLE_LABEL[lifecycle] ?? lifecycle}</span>
            </div>
            {outpass.isOverdueReturn && <p className="text-xs font-semibold text-rose-700">Return is overdue — report to the Warden office.</p>}
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
            <button
              onClick={savePass}
              disabled={!usable || !qr}
              type="button"
              className="flex-1 w-full py-2.5 px-4 rounded-xl border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">download</span>
              <span>Save QR Image</span>
            </button>
          </div>
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3 text-[11px] text-slate-500">
          <span>Show this pass at the gate. Security scans the QR (or enters your register number) to record exit and return.</span>
          <button onClick={onClose} type="button" className="font-bold text-[var(--kv-primary)] hover:underline shrink-0">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
