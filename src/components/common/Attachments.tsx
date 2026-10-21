import React, { useRef, useState } from 'react';
import { downloadFile, errorMessage, fileToBase64, http, qs } from '../../services/http';
import { useResource } from '../../hooks/useApi';
import { Button, Icon } from './ui';

interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  ownerName: string;
}

const MAX = 5 * 1024 * 1024;
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx';
const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Lists files on a record; optionally lets the user upload (server enforces who may). */
export const Attachments: React.FC<{ entityType: string; entityId: string; canUpload?: boolean; onToast: (m: string, e?: boolean) => void; label?: string }> = ({
  entityType,
  entityId,
  canUpload,
  onToast,
  label = 'Attachments',
}) => {
  const { data, error, reload } = useResource(() => http.get<Attachment[]>(`/attachments${qs({ entityType, entityId })}`), [entityType, entityId]);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    if (file.size > MAX) return onToast('Files must be 5 MB or smaller.', true);
    setUploading(true);
    try {
      const dataBase64 = await fileToBase64(file);
      await http.post('/attachments', { entityType, entityId, fileName: file.name, mimeType: file.type || 'application/octet-stream', dataBase64 });
      onToast(`${file.name} attached.`);
      reload();
    } catch (err) {
      onToast(errorMessage(err), true);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--kv-heading)]">{label}</span>
        {canUpload && (
          <>
            <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} aria-label="Choose file to attach" />
            <Button size="sm" variant="secondary" icon="attach_file" loading={uploading} onClick={() => input.current?.click()}>
              Attach file
            </Button>
          </>
        )}
      </div>
      {error && <p className="text-xs text-rose-700">{error}</p>}
      {data && data.length === 0 && <p className="text-xs text-[var(--kv-text-muted)]">No files attached.</p>}
      {data && data.length > 0 && (
        <ul className="divide-y divide-[var(--kv-border-soft)] border border-[var(--kv-border)] rounded-lg">
          {data.map((a) => (
            <li key={a.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <Icon name="description" className="text-[18px] text-[var(--kv-primary)]" />
              <span className="flex-1 min-w-0 truncate">{a.fileName}</span>
              <span className="text-[11px] text-[var(--kv-text-muted)] hidden sm:inline">
                {size(a.sizeBytes)} · {a.ownerName}
              </span>
              <Button size="sm" variant="ghost" icon="download" onClick={() => downloadFile(`/attachments/${a.id}/download`, a.fileName).catch((e) => onToast(errorMessage(e), true))}>
                <span className="sr-only">Download {a.fileName}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
