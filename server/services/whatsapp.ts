/**
 * WhatsApp delivery for parent/guardian outing approvals.
 *
 * The app talks to the WhatsApp Business Cloud API (Meta Graph). Nothing is faked:
 * when the integration is not configured, every send reports "Not Configured" with
 * the exact variables that are missing, and the approval link is surfaced in the
 * portal so staff can pass it on by another verified channel.
 *
 * Required environment variables:
 *   WHATSAPP_PHONE_NUMBER_ID   the sender's phone-number id from Meta Business
 *   WHATSAPP_ACCESS_TOKEN      a permanent system-user access token
 *   PUBLIC_BASE_URL            the externally reachable base URL of this app,
 *                              used to build the parent's approval link
 * Optional:
 *   WHATSAPP_API_VERSION       Graph API version (default v21.0)
 *   WHATSAPP_TEMPLATE_NAME     an approved template name; when set the message is
 *                              sent as a template, which is required outside the
 *                              24-hour customer-service window
 *   WHATSAPP_TEMPLATE_LANG     template language code (default en)
 */

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  apiVersion: string;
  templateName: string | null;
  templateLang: string;
  publicBaseUrl: string;
}

export interface DeliveryResult {
  status: 'Sent' | 'Failed' | 'Not Configured';
  providerMessageId: string | null;
  error: string | null;
}

const REQUIRED = ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'PUBLIC_BASE_URL'] as const;

export function missingConfig(): string[] {
  return REQUIRED.filter((key) => !process.env[key]);
}

export const isConfigured = () => missingConfig().length === 0;

export function config(): WhatsAppConfig | null {
  if (!isConfigured()) return null;
  return {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN!,
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
    templateName: process.env.WHATSAPP_TEMPLATE_NAME || null,
    templateLang: process.env.WHATSAPP_TEMPLATE_LANG || 'en',
    publicBaseUrl: process.env.PUBLIC_BASE_URL!.replace(/\/$/, ''),
  };
}

/** Integration status for the portals, including what is still needed. */
export function integrationStatus() {
  const missing = missingConfig();
  const c = config();
  return {
    provider: 'WhatsApp Business Cloud API',
    configured: missing.length === 0,
    missing,
    templateMode: c?.templateName ? `template "${c.templateName}" (${c.templateLang})` : 'free-form text (only valid inside the 24-hour service window)',
    publicBaseUrl: c?.publicBaseUrl ?? null,
    instructions:
      missing.length === 0
        ? 'Configured. Approval requests are sent to the parent number stored on the student profile.'
        : `Set ${missing.join(', ')} in the server environment and restart the API. Until then the approval link is shown in the portal so it can be passed on through a verified channel; no WhatsApp message is sent.`,
  };
}

/** E.164 without the leading '+', which is what the Graph API expects. */
export function normalisePhone(raw: string, defaultCountryCode = process.env.DEFAULT_COUNTRY_CODE || '91'): string | null {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `${defaultCountryCode}${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

/**
 * The guardian's approval URL. With PUBLIC_BASE_URL set it is absolute and can be
 * sent over WhatsApp; without it, a site-relative path is still returned so staff
 * can pass the link on through a verified channel rather than being stuck.
 */
export function approvalLink(token: string): string {
  const base = config()?.publicBaseUrl ?? process.env.PUBLIC_BASE_URL?.replace(/\/$/, '');
  return `${base ?? ''}/parent/outing/${token}`;
}

export interface ApprovalMessage {
  toPhone: string;
  parentName: string | null;
  studentName: string;
  outingId: string;
  destination: string;
  outAt: string;
  returnAt: string;
  /** Map link for where the student was standing when they raised the request, if they shared it. */
  locationLink: string | null;
  link: string;
}

/** Google Maps link for a fix; `null` when the student did not share one. */
export function mapsLink(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (lat == null || lng == null || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) return null;
  return `https://www.google.com/maps/search/?api=1&query=${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
}

export function messageText(m: ApprovalMessage): string {
  return [
    `KVCET Hostel — outing approval request ${m.outingId}`,
    '',
    `${m.studentName} has requested permission to go out.`,
    `Destination: ${m.destination}`,
    `Leaves: ${m.outAt}`,
    `Expected back: ${m.returnAt}`,
    '',
    `Approve or decline here: ${m.link}`,
    'This link is personal to you and expires. If you did not expect this message, please contact the hostel office.',
  ].join('\n');
}

/** Sends the approval request. Returns the real outcome; it never claims success. */
export async function sendApprovalRequest(m: ApprovalMessage): Promise<DeliveryResult> {
  const c = config();
  if (!c) {
    return { status: 'Not Configured', providerMessageId: null, error: `WhatsApp is not configured (missing ${missingConfig().join(', ')}).` };
  }
  const to = normalisePhone(m.toPhone);
  if (!to) return { status: 'Failed', providerMessageId: null, error: `"${m.toPhone}" is not a usable WhatsApp number.` };

  const body = c.templateName
    ? {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: c.templateName,
          language: { code: c.templateLang },
          components: [
            {
              type: 'body',
              parameters: [m.studentName, m.destination, m.outAt, m.returnAt, m.outingId].map((text) => ({ type: 'text', text })),
            },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: m.link.split('/').pop() }] },
          ],
        },
      }
    : { messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: false, body: messageText(m) } };

  try {
    const res = await fetch(`https://graph.facebook.com/${c.apiVersion}/${c.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      return { status: 'Failed', providerMessageId: null, error: json?.error?.message ? `${res.status}: ${json.error.message}` : `WhatsApp API returned ${res.status}.` };
    }
    return { status: 'Sent', providerMessageId: json?.messages?.[0]?.id ?? null, error: null };
  } catch (err) {
    return { status: 'Failed', providerMessageId: null, error: err instanceof Error ? err.message : 'WhatsApp request failed.' };
  }
}

// ---------------------------------------------------------------------------
// Worker job dispatch (automatic complaint routing)
// ---------------------------------------------------------------------------
export interface WorkerJobMessage {
  toPhone: string;
  workerName: string;
  trade: string;
  complaintId: string;
  category: string;
  priority: string;
  title: string;
  description: string;
  location: string;
  /** Resolution deadline, already formatted for a human reader. */
  deadline: string;
  /** Where the worker reports the job done; personal to this one assignment. */
  link: string;
}

/**
 * The worker's job page. With PUBLIC_BASE_URL set it is absolute and can be sent
 * over WhatsApp; without it a site-relative path still comes back, so the office
 * can pass the link on by another route rather than being stuck.
 */
export function workerJobLink(token: string): string {
  const base = config()?.publicBaseUrl ?? process.env.PUBLIC_BASE_URL?.replace(/\/$/, '');
  return `${base ?? ''}/worker/job/${token}`;
}

export function workerJobText(m: WorkerJobMessage): string {
  return [
    `KVCET Hostel - ${m.trade} job ${m.complaintId}`,
    '',
    `${m.workerName}, a ${m.category.toLowerCase()} complaint has been assigned to you.`,
    `Issue: ${m.title}`,
    `Where: ${m.location}`,
    `Priority: ${m.priority}`,
    `Finish by: ${m.deadline}`,
    '',
    m.description,
    '',
    `Report the work done here: ${m.link}`,
    'This link is personal to this job. Do not forward it.',
  ].join('\n');
}

/**
 * Sends the job to the worker over WhatsApp. The message is free-form text: the
 * approval template is specific to parents, so when a template is configured it
 * is deliberately not reused here. Outside WhatsApp's 24-hour service window a
 * free-form message is rejected by Meta, and that rejection is reported as-is
 * rather than being swallowed - the Warden still sees the worker's number.
 */
export async function sendWorkerJob(m: WorkerJobMessage): Promise<DeliveryResult> {
  const c = config();
  if (!c) return { status: 'Not Configured', providerMessageId: null, error: `WhatsApp is not configured (missing ${missingConfig().join(', ')}).` };
  const to = normalisePhone(m.toPhone);
  if (!to) return { status: 'Failed', providerMessageId: null, error: `"${m.toPhone}" is not a usable WhatsApp number.` };
  try {
    const res = await fetch(`https://graph.facebook.com/${c.apiVersion}/${c.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: false, body: workerJobText(m) } }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      return { status: 'Failed', providerMessageId: null, error: json?.error?.message ? `${res.status}: ${json.error.message}` : `WhatsApp API returned ${res.status}.` };
    }
    return { status: 'Sent', providerMessageId: json?.messages?.[0]?.id ?? null, error: null };
  } catch (err) {
    return { status: 'Failed', providerMessageId: null, error: err instanceof Error ? err.message : 'WhatsApp request failed.' };
  }
}
