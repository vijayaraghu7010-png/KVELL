import React, { useCallback, useEffect, useState } from 'react';
import { errorMessage, http } from '../../services/http';
import { STUDY_SCANNER_EVENT } from '../common/Notifications';
import { Badge, Button, ErrorState, Loading, Modal, clock12 } from '../common/ui';
import { Countdown, QrImage } from '../common/QrTools';

interface LiveStudySession {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  location: string;
  status: string;
  expected: number;
  present: number;
  pendingReconciliation: number;
}

interface Loaded {
  session: LiveStudySession;
  token: string;
  expiresAt: string;
}

/**
 * The Adviser's attendance QR, opened from the notification the session sends when
 * it starts. The Adviser shows it to the room; the students scan it from their own
 * notification. There is nothing to press afterwards — the code lives for the ten
 * minutes the office allowed and the session closes itself when it expires.
 */
export const StudySessionQrModal: React.FC = () => {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setSessionId(null);
    setData(null);
    setError(null);
  };

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const detail = await http.get<{ session: LiveStudySession }>(`/adviser/study-sessions/${id}`);
      const qr = await http.get<{ token: string | null; expiresAt: string; live: boolean }>(`/adviser/study-sessions/${id}/qr?phase=Start`);
      if (!qr.live || !qr.token) throw new Error('This session’s attendance QR has expired, so the session has closed.');
      setData({ session: detail.session, token: qr.token, expiresAt: qr.expiresAt });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Opened by tapping the "session started" notification.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (!id) return;
      setData(null);
      setError(null);
      setSessionId(id);
      load(id);
    };
    window.addEventListener(STUDY_SCANNER_EVENT, onOpen);
    return () => window.removeEventListener(STUDY_SCANNER_EVENT, onOpen);
  }, [load]);

  return (
    <Modal
      open={!!sessionId}
      onClose={close}
      title="Attendance QR"
      description={data ? `${data.session.title} · ${data.session.location} · ${clock12(data.session.startTime)}–${clock12(data.session.endTime)}` : undefined}
      footer={
        <>
          <Button variant="secondary" icon="refresh" onClick={() => sessionId && load(sessionId)}>
            Refresh
          </Button>
          <Button variant="secondary" onClick={close}>
            Close
          </Button>
        </>
      }
    >
      {loading ? (
        <Loading rows={3} />
      ) : error ? (
        <ErrorState message={error} onRetry={sessionId ? () => load(sessionId) : undefined} />
      ) : data ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="slate">
              {data.session.present}/{data.session.expected} scanned
            </Badge>
            {data.session.pendingReconciliation > 0 && <Badge tone="amber">{data.session.pendingReconciliation} not scanned yet</Badge>}
          </div>

          <div className="flex flex-col sm:flex-row gap-4 items-center">
            <QrImage value={data.token} alt="Attendance QR code for this study session" size={200} />
            <div className="text-sm space-y-1">
              <p className="text-xs text-[var(--kv-text-muted)]">Show this to the students in the room. They scan it from their own notification.</p>
              <p className="text-xs text-[var(--kv-text-muted)]">
                <Countdown expiresAt={data.expiresAt} onExpired={() => setError('The attendance QR has expired and the session has closed.')} className="font-semibold text-[var(--kv-heading)]" />
              </p>
              <p className="text-[11px] text-[var(--kv-text-muted)]">
                Anyone who has not scanned by then is marked absent. Press Refresh to see the count rise.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
};
