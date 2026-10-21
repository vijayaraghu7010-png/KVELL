/**
 * Single HTTP client for the KVCET API.
 * - Sends the session cookie (same-origin) and JSON bodies.
 * - Never substitutes demo data: failures surface as ApiError so the UI can show them.
 * - A 401 broadcasts `kvcet:unauthorized` so the app can return to the login screen.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: any,
  ) {
    super(message);
  }
  /** Field-level validation messages, when the server provided them. */
  get fields(): Record<string, string> {
    return this.details?.fields ?? {};
  }
}

export const UNAUTHORIZED_EVENT = 'kvcet:unauthorized';

async function request<T>(method: string, path: string, body?: unknown): Promise<{ data: T; message?: string; raw: any }> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and that the API server is running.', 'network_error');
  }
  let json: any = null;
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/login')) {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: json?.message }));
    }
    const message = json?.message || (res.status >= 500 ? 'The server could not complete the request.' : `Request failed (${res.status}).`);
    throw new ApiError(res.status, message, json?.error, json?.details);
  }
  if (!json || json.success === false) throw new ApiError(res.status, json?.message || 'Unexpected response from the server.');
  return { data: json.data as T, message: json.message, raw: json };
}

export const http = {
  get: <T>(path: string) => request<T>('GET', path).then((r) => r.data),
  getRaw: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown = {}) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown = {}) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  });
  const str = s.toString();
  return str ? `?${str}` : '';
};

/** Triggers a browser download of an API resource (CSV exports, attachments). */
export async function downloadFile(path: string, fallbackName: string) {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!res.ok) {
    let message = `Download failed (${res.status}).`;
    try {
      message = (await res.json()).message || message;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, message);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.');
