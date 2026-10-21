import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { OutingRequest, TrackingStatus } from '../../types';
import { http, errorMessage } from '../../services/http';

/**
 * Location sharing for an approved outing, which is a condition of the permission
 * rather than a choice: it starts by itself as soon as an outing is approved and
 * under way, and only stops when the student is back — the server ends it when the
 * gate records the return (or when the approved window closes), and this stops
 * watching the moment the server says so.
 *
 * The browser is the only thing that can tell us what is happening, and it cannot
 * distinguish "GPS switched off" from "no signal" or "permission revoked in
 * settings". So this reports exactly what the Geolocation API returns — a fix, a
 * denied permission, or a positioning error — and the server records that, nothing
 * more.
 */
const PING_INTERVAL_MS = 60_000;

const STATUS_COPY: Record<TrackingStatus, { label: string; tone: string }> = {
  'Not Started': { label: 'Starting…', tone: 'bg-slate-100 text-slate-600 border-slate-200' },
  'Permission Granted': { label: 'Permission granted', tone: 'bg-[var(--kv-surface-alt)] text-[var(--kv-primary)] border-[var(--kv-border)]' },
  Active: { label: 'Sharing location', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  Unavailable: { label: 'Location unavailable', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  Denied: { label: 'Permission denied', tone: 'bg-rose-50 text-rose-700 border-rose-200' },
  Revoked: { label: 'Permission revoked', tone: 'bg-rose-50 text-rose-700 border-rose-200' },
  Stopped: { label: 'Sharing stopped — you are back', tone: 'bg-slate-100 text-slate-600 border-slate-200' },
};

interface TrackingView {
  status: TrackingStatus;
  isInterrupted: boolean;
  lastUpdateDisplay: string;
  interruptionReason: string | null;
  stoppedAt: string | null;
  stopReason: string | null;
}

export const OutingLocationSharing: React.FC<{ outings: OutingRequest[]; onShowToast: (m: string, e?: boolean) => void; onChanged: () => void }> = ({ outings, onShowToast, onChanged }) => {
  const active = outings.find((o) => o.status === 'Approved' && (!o.expectedReturnAt || Date.parse(o.expectedReturnAt) > Date.now()));
  const [tracking, setTracking] = useState<TrackingView | null>(null);
  const watchId = useRef<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const outingId = active?.id;

  /** Releases the browser watch. Safe to call repeatedly. */
  const stopWatching = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    if (timer.current) {
      window.clearInterval(timer.current);
      timer.current = undefined;
    }
  }, []);

  const report = useCallback(
    async (status: TrackingStatus, extra: { latitude?: number; longitude?: number; accuracyM?: number; reason?: string } = {}) => {
      if (!outingId) return;
      try {
        const res = await http.post<TrackingView>(`/student/outing-requests/${outingId}/tracking`, { status, ...extra });
        setTracking(res.data);
        // The server ends tracking when the gate records the return; honour that at once.
        if (res.data.status === 'Stopped') {
          stopWatching();
          onChanged();
        }
      } catch (err) {
        onShowToast(errorMessage(err), true);
      }
    },
    [outingId, onShowToast, onChanged, stopWatching],
  );

  // Sharing is not opt-in: it begins as soon as there is an approved outing under way.
  useEffect(() => {
    if (!outingId) {
      stopWatching();
      setTracking(null);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const res = await http.get<{ tracking: TrackingView | null }>(`/student/outing-requests/${outingId}/tracking`);
        if (cancelled) return;
        setTracking(res.tracking);
        if (res.tracking?.status === 'Stopped') return; // already back
      } catch {
        /* the status strip just stays empty until the first ping lands */
      }
      if (cancelled || !navigator.geolocation) {
        if (!cancelled && !navigator.geolocation) report('Unavailable', { reason: 'This browser cannot provide a location.' });
        return;
      }

      let last: GeolocationPosition | null = null;
      watchId.current = navigator.geolocation.watchPosition(
        (pos) => {
          last = pos;
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) report('Denied', { reason: 'Location permission was denied on the device.' });
          else report('Unavailable', { reason: err.message || 'The device could not determine a position.' });
        },
        { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
      );
      report('Permission Granted');
      // One ping a minute rather than one per fix: enough for the Warden, light on battery.
      timer.current = window.setInterval(() => {
        if (last) report('Active', { latitude: last.coords.latitude, longitude: last.coords.longitude, accuracyM: Math.round(last.coords.accuracy) });
      }, PING_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      stopWatching();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outingId]);

  if (!outingId) return null;
  const copy = STATUS_COPY[tracking?.status ?? 'Not Started'];

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-2" aria-label="Outing location sharing">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-[var(--kv-heading)]">Location sharing · outing {outingId}</h2>
        <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${copy.tone}`}>{copy.label}</span>
      </div>
      <p className="text-xs text-slate-600">
        Sharing is part of your outing permission and runs by itself. It switches off on its own once the gate records you back at the hostel.
      </p>
      {tracking && <p className="text-[11px] text-slate-500">Last update: {tracking.lastUpdateDisplay}</p>}
      {tracking?.stopReason && <p className="text-[11px] text-slate-500">{tracking.stopReason}</p>}
      {tracking && ['Denied', 'Revoked', 'Unavailable'].includes(tracking.status) && (
        <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5" role="alert">
          Turn location back on for this site. The hostel is told when updates stop arriving.
        </p>
      )}
    </section>
  );
};
