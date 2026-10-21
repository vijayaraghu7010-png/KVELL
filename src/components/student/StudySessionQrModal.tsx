import React, { useCallback, useEffect, useState } from 'react';
import { errorMessage, http } from '../../services/http';
import { STUDY_QR_EVENT } from '../common/Notifications';
import { Badge, Button, ErrorState, Loading, Modal, clock12 } from '../common/ui';
import { Countdown, QrScanner } from '../common/QrTools';

interface LiveSession {
  id: string;
  title: string;
  location: string;
  startTime: string;
  endTime: string;
  adviserName: string | null;
  myStatus: string;
  startQrLive: boolean;
  startQrExpiresAt: string | null;
  endQrLive: boolean;
  endQrExpiresAt: string | null;
}

interface ScanResult {
  phase: 'Start' | 'End';
  attendanceStatus: string;
  scannedAtDisplay: string;
  message: string;
}

/**
 * The student's attendance scanner, opened from the session's notification — the
 * portal has no attendance page of its own. The Adviser shows the session QR; this
 * reads it and records the attendance. The window is enforced server-side, so a
 * scanner left open on screen stops working on its own.
 */
export const StudySessionQrModal: React.FC<{ onShowToast: (m: string, e?: boolean) => void }> = ({ onShowToast }) => {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<LiveSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);

  const close = () => {
    setSessionId(null);
    setSession(null);
    setError(null);
    setResult(null);
  };

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const live = await http.get<LiveSession[]>('/student/study-sessions/live');
      const found = live.find((s) => s.id === id);
      if (!found) throw new Error('This session is not open to you — you may not be on its roster, or it has already closed.');
      if (!found.startQrLive && !found.endQrLive) throw new Error('The scanning window for this session has closed.');
      setSession(found);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Opened by tapping a study-session notification (bell or notifications page).
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (!id) return;
      setSession(null);
      setResult(null);
      setError(null);
      setSessionId(id);
      load(id);
    };
    window.addEventListener(STUDY_QR_EVENT, onOpen);
    return () => window.removeEventListener(STUDY_QR_EVENT, onOpen);
  }, [load]);

  /** Sends a token the camera read, or one typed in by hand. */
  const submit = async (token: string) => {
    setBusy(true);
    try {
      const res = await http.post<ScanResult>('/student/study-sessions/scan', { token });
      setResult(res.data);
      onShowToast(res.message ?? 'Attendance recorded.');
    } catch (err) {
      onShowToast(errorMessage(err), true);
    } finally {
      setBusy(false);
    }
  };

  const expiresAt = session?.startQrLive ? session.startQrExpiresAt : session?.endQrExpiresAt;

  return (
    <Modal
      open={!!sessionId}
      onClose={close}
      title="Scan your attendance"
      description={session ? `${session.title} · ${session.location} · ${clock12(session.startTime)}–${clock12(session.endTime)}` : undefined}
      footer={
        <Button variant="secondary" onClick={close}>
          Close
        </Button>
      }
    >
      {loading ? (
        <Loading rows={3} />
      ) : error ? (
        <ErrorState message={error} onRetry={sessionId ? () => load(sessionId) : undefined} />
      ) : session ? (
        <div className="space-y-4">
          <div className="text-sm space-y-1">
            <p className="text-xs text-[var(--kv-text-muted)]">
              Point your camera at the QR {session.adviserName ? `${session.adviserName} is showing` : 'your Adviser is showing'}. If the camera cannot be used, type the code shown under it instead.
            </p>
            {expiresAt && (
              <p className="text-xs text-[var(--kv-text-muted)]">
                <Countdown expiresAt={expiresAt} onExpired={() => setError('The scanning window has closed.')} className="font-semibold text-[var(--kv-heading)]" /> — after this you are marked absent.
              </p>
            )}
          </div>

          {!result && <QrScanner label="Scan the session QR" busy={busy} onDetect={(token) => submit(token)} />}

          {result && (
            <div
              className={`rounded-xl p-3 text-sm ${result.attendanceStatus === 'Present' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-amber-50 border border-amber-200 text-amber-900'}`}
              role="status"
            >
              <p className="font-semibold">
                {result.phase} scan recorded at {result.scannedAtDisplay} — attendance:{' '}
                <Badge tone={result.attendanceStatus === 'Present' ? 'green' : 'red'}>{result.attendanceStatus}</Badge>
              </p>
              <p className="text-xs mt-0.5">{result.message}</p>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
};
