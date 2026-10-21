import React, { useEffect, useState } from 'react';
import { http, qs } from '../../services/http';
import { useAction } from '../../hooks/useApi';
import { Badge, Button, Card, KeyValue, SelectField, StatusBadge, TextField } from '../../components/common/ui';
import { QrScanner } from '../../components/common/QrTools';

interface VerifyResult {
  student: { id: string; name: string; regNumber: string; roomNumber: string; department: string; enrollmentStatus: string };
  pass: { id: string; type: string; title: string; dateRange: string; timeSlot: string; lifecycleStatus: string; isOverdueReturn: boolean; approvals: string; remarks: string } | null;
  suggestedType: 'Entry' | 'Exit';
  verdict: 'valid' | 'not-yet-valid-or-expired' | 'no-pass';
}

const VERDICT: Record<VerifyResult['verdict'], { tone: 'green' | 'amber' | 'red'; text: string }> = {
  valid: { tone: 'green', text: 'Valid pass' },
  'not-yet-valid-or-expired': { tone: 'amber', text: 'Pass not valid right now' },
  'no-pass': { tone: 'red', text: 'No approved pass' },
};

/** Gate desk: scan or enter → verify against the server → record Entry/Exit. */
export const SecurityQRScanner: React.FC<{ onRecorded: () => void; onShowToast: (m: string, e?: boolean) => void }> = ({ onRecorded, onShowToast }) => {
  const [token, setToken] = useState('');
  const [regNumber, setRegNumber] = useState('');
  const [gate, setGate] = useState('Main Gate');
  // Identifies the scanning device on the canonical gate event; remembered per browser.
  const [deviceId, setDeviceId] = useState(() => {
    try {
      return localStorage.getItem('kvcet.gateDeviceId') ?? '';
    } catch {
      return '';
    }
  });
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [suggestions, setSuggestions] = useState<{ id: string; name: string; regNumber: string; roomNumber: string }[]>([]);
  const { run, pending } = useAction(onShowToast);

  const verify = async (by: { token?: string; regNumber?: string }) => {
    setVerifying(true);
    setVerifyError(null);
    setResult(null);
    try {
      setResult(await http.get<VerifyResult>(`/security/verify${qs(by)}`));
    } catch (err: any) {
      setVerifyError(err.message);
    } finally {
      setVerifying(false);
    }
  };

  useEffect(() => {
    const q = regNumber.trim();
    if (q.length < 2 || result) return setSuggestions([]);
    const t = setTimeout(() => {
      http
        .get<{ id: string; name: string; regNumber: string; roomNumber: string }[]>(`/security/students${qs({ search: q })}`)
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, 250);
    return () => clearTimeout(t);
  }, [regNumber, result]);

  const record = async (type: 'Entry' | 'Exit') => {
    const body = { qrToken: token.trim() || undefined, regNumber: token.trim() ? undefined : regNumber.trim(), type, gate, deviceId: deviceId.trim() || undefined, notes: notes.trim() || undefined };
    const r = await run(() => http.post('/security/scan', body));
    if (r) {
      setResult(null);
      setToken('');
      setRegNumber('');
      setNotes('');
      onRecorded();
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card title="Scan or enter a pass">
        <div className="space-y-4">
          {/* One scanner for the whole app: native detector, JavaScript fallback,
              photo fallback and typed code, in that order of preference. */}
          <QrScanner
            label="Scan the student's pass"
            showManual={false}
            busy={verifying || pending}
            onDetect={(value) => {
              setToken(value);
              setRegNumber('');
              verify({ token: value });
            }}
          />
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (token.trim()) verify({ token: token.trim() });
              else if (regNumber.trim()) verify({ regNumber: regNumber.trim() });
              else setVerifyError('Scan a QR code, or enter the pass code or a register number.');
            }}
          >
            <TextField label="Pass code (from the student's QR)" value={token} onChange={(e) => (setToken(e.target.value), setResult(null))} placeholder="KVCET-…" />
            <div className="relative">
              <TextField label="…or register number" value={regNumber} onChange={(e) => (setRegNumber(e.target.value), setToken(''), setResult(null))} placeholder="e.g. 22CS089" autoComplete="off" />
              {suggestions.length > 0 && (
                <ul className="absolute z-20 left-0 right-0 mt-1 bg-white border border-[var(--kv-border)] rounded-lg shadow-lg max-h-56 overflow-y-auto">
                  {suggestions.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--kv-accent-soft)]"
                        onClick={() => {
                          setRegNumber(s.regNumber);
                          setSuggestions([]);
                          verify({ regNumber: s.regNumber });
                        }}
                      >
                        {s.name} · <span className="font-mono">{s.regNumber}</span> · Room {s.roomNumber}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Button type="submit" icon="verified_user" loading={verifying}>
              Verify
            </Button>
            {verifyError && (
              <p className="text-sm text-rose-700" role="alert">
                {verifyError}
              </p>
            )}
          </form>
        </div>
      </Card>

      <Card title="Verification result">
        {!result ? (
          <p className="text-sm text-[var(--kv-text-muted)]">Verify a pass to see the student, the pass validity and record the movement.</p>
        ) : (
          <div className="space-y-4" aria-live="polite">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={VERDICT[result.verdict].tone} icon={result.verdict === 'valid' ? 'check_circle' : 'warning'}>
                {VERDICT[result.verdict].text}
              </Badge>
              {result.pass?.isOverdueReturn && <Badge tone="red">Return overdue</Badge>}
              {result.student.enrollmentStatus !== 'Active' && <Badge tone="red">Enrollment: {result.student.enrollmentStatus}</Badge>}
            </div>
            <KeyValue
              items={[
                ['Student', result.student.name],
                ['Register no', result.student.regNumber],
                ['Room', result.student.roomNumber],
                ['Department', result.student.department],
                ['Pass', result.pass ? `${result.pass.id} · ${result.pass.type}` : '—'],
                ['Pass status', result.pass ? <StatusBadge key="ps" status={result.pass.lifecycleStatus} /> : 'No pass'],
                ['Valid', result.pass ? `${result.pass.dateRange} · ${result.pass.timeSlot}` : '—'],
                ['Approved by', result.pass?.approvals ?? '—'],
              ]}
            />
            {result.pass?.remarks && <p className="text-xs text-[var(--kv-text-muted)] bg-[var(--kv-surface-alt)] border border-[var(--kv-border)] rounded-lg p-2">{result.pass.remarks}</p>}
            <div className="grid sm:grid-cols-2 gap-3">
              <SelectField label="Gate" value={gate} onChange={(e) => setGate(e.target.value)} options={['Main Gate', 'North Gate', 'Hostel Gate', 'East Gate']} />
              <TextField
                label="Scanning device"
                value={deviceId}
                placeholder="e.g. GATE-TAB-01"
                hint="Recorded on every gate event from this device."
                onChange={(e) => {
                  setDeviceId(e.target.value);
                  try {
                    localStorage.setItem('kvcet.gateDeviceId', e.target.value);
                  } catch {
                    /* private mode: the device id is simply not remembered */
                  }
                }}
              />
              <TextField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant={result.suggestedType === 'Exit' ? 'primary' : 'secondary'} icon="logout" loading={pending} onClick={() => record('Exit')}>
                Record EXIT
              </Button>
              <Button variant={result.suggestedType === 'Entry' ? 'primary' : 'secondary'} icon="login" loading={pending} onClick={() => record('Entry')}>
                Record ENTRY
              </Button>
            </div>
            <p className="text-[11px] text-[var(--kv-text-muted)]">An exit without a valid pass is still recorded but flagged, and the Warden is alerted. Late returns are flagged automatically.</p>
          </div>
        )}
      </Card>
    </div>
  );
};
