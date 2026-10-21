import { badRequest } from './http';

/**
 * Minimal declarative validation. Collects every field error so forms can show them together.
 * Usage: const v = new Validator(req.body); const title = v.string('title', { max: 200 }); v.done();
 */
export class Validator {
  private errors: Record<string, string> = {};
  constructor(private body: any) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) this.body = {};
  }

  private fail(field: string, message: string) {
    if (!this.errors[field]) this.errors[field] = message;
  }

  has(field: string) {
    const v = this.body[field];
    return v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
  }

  string(field: string, opts: { required?: boolean; max?: number; min?: number; label?: string } = {}): string | undefined {
    const { required = true, max = 2000, min = 0, label = field } = opts;
    const raw = this.body[field];
    if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
      if (required) this.fail(field, `${label} is required.`);
      return undefined;
    }
    if (typeof raw !== 'string' && typeof raw !== 'number') {
      this.fail(field, `${label} must be text.`);
      return undefined;
    }
    const value = String(raw).trim();
    if (value.length < min) this.fail(field, `${label} must be at least ${min} characters.`);
    if (value.length > max) this.fail(field, `${label} must be at most ${max} characters.`);
    return value;
  }

  oneOf<T extends string>(field: string, allowed: readonly T[], opts: { required?: boolean; label?: string } = {}): T | undefined {
    const { required = true, label = field } = opts;
    const raw = this.body[field];
    if (raw === undefined || raw === null || raw === '') {
      if (required) this.fail(field, `${label} is required.`);
      return undefined;
    }
    if (!allowed.includes(raw)) {
      this.fail(field, `${label} must be one of: ${allowed.join(', ')}.`);
      return undefined;
    }
    return raw as T;
  }

  int(field: string, opts: { required?: boolean; min?: number; max?: number; label?: string } = {}): number | undefined {
    const { required = true, min = -Infinity, max = Infinity, label = field } = opts;
    const raw = this.body[field];
    if (raw === undefined || raw === null || raw === '') {
      if (required) this.fail(field, `${label} is required.`);
      return undefined;
    }
    const n = Number(raw);
    if (!Number.isInteger(n)) {
      this.fail(field, `${label} must be a whole number.`);
      return undefined;
    }
    if (n < min || n > max) this.fail(field, `${label} must be between ${min} and ${max}.`);
    return n;
  }

  number(field: string, opts: { required?: boolean; min?: number; max?: number; label?: string } = {}): number | undefined {
    const { required = true, min = -Infinity, max = Infinity, label = field } = opts;
    const raw = this.body[field];
    if (raw === undefined || raw === null || raw === '') {
      if (required) this.fail(field, `${label} is required.`);
      return undefined;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      this.fail(field, `${label} must be a number.`);
      return undefined;
    }
    if (n < min || n > max) this.fail(field, `${label} must be between ${min} and ${max}.`);
    return n;
  }

  bool(field: string, fallback = false): boolean {
    const raw = this.body[field];
    if (raw === undefined || raw === null || raw === '') return fallback;
    return raw === true || raw === 'true' || raw === 1 || raw === '1';
  }

  /** Calendar date 'YYYY-MM-DD'. */
  date(field: string, opts: { required?: boolean; label?: string } = {}): string | undefined {
    const { required = true, label = field } = opts;
    const raw = this.string(field, { required, max: 10, label });
    if (raw === undefined) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
      this.fail(field, `${label} must be a valid date (YYYY-MM-DD).`);
      return undefined;
    }
    return raw;
  }

  /** 'HH:MM' 24-hour time. */
  time(field: string, opts: { required?: boolean; label?: string } = {}): string | undefined {
    const { required = true, label = field } = opts;
    const raw = this.string(field, { required, max: 5, label });
    if (raw === undefined) return undefined;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
      this.fail(field, `${label} must be a valid time (HH:MM).`);
      return undefined;
    }
    return raw;
  }

  /** Any parseable date-time; normalised to ISO UTC. */
  dateTime(field: string, opts: { required?: boolean; label?: string } = {}): string | undefined {
    const { required = true, label = field } = opts;
    const raw = this.string(field, { required, max: 40, label });
    if (raw === undefined) return undefined;
    const t = Date.parse(raw);
    if (Number.isNaN(t)) {
      this.fail(field, `${label} must be a valid date and time.`);
      return undefined;
    }
    return new Date(t).toISOString();
  }

  stringArray(field: string, opts: { required?: boolean; max?: number; label?: string } = {}): string[] {
    const { required = false, max = 500, label = field } = opts;
    const raw = this.body[field];
    if (raw === undefined || raw === null) {
      if (required) this.fail(field, `${label} is required.`);
      return [];
    }
    if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string')) {
      this.fail(field, `${label} must be a list.`);
      return [];
    }
    if (raw.length > max) this.fail(field, `${label} may contain at most ${max} entries.`);
    if (required && raw.length === 0) this.fail(field, `${label} must not be empty.`);
    return Array.from(new Set(raw.map((s: string) => s.trim()).filter(Boolean)));
  }

  check(condition: boolean, field: string, message: string) {
    if (!condition) this.fail(field, message);
  }

  done() {
    const keys = Object.keys(this.errors);
    if (keys.length) {
      throw badRequest(this.errors[keys[0]], { fields: this.errors });
    }
  }
}
