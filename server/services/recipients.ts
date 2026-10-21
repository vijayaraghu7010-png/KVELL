import { db } from '../db/database';
import { badRequest } from '../lib/http';
import { inList } from '../lib/util';

/**
 * How the Dean addresses HODs/Advisers. Resolution happens on the server so a client
 * cannot slip in arbitrary users (only active HOD/Adviser accounts are eligible).
 */
export interface RecipientSelector {
  allHods?: boolean;
  allAdvisers?: boolean;
  departments?: string[]; // limit "all" selections to these departments
  userIds?: string[]; // explicit individuals
}

export interface Recipient {
  id: string;
  name: string;
  email: string;
  role: 'HOD' | 'Adviser';
  department: string;
}

export function parseSelector(raw: any): RecipientSelector {
  if (!raw || typeof raw !== 'object') throw badRequest('Choose at least one recipient.');
  const arr = (v: unknown, label: string) => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw badRequest(`${label} must be a list.`);
    return v as string[];
  };
  return {
    allHods: raw.allHods === true,
    allAdvisers: raw.allAdvisers === true,
    departments: arr(raw.departments, 'Departments'),
    userIds: arr(raw.userIds, 'Recipients'),
  };
}

export function resolveRecipients(sel: RecipientSelector): Recipient[] {
  const out = new Map<string, Recipient>();
  const add = (rows: any[]) => rows.forEach((r) => out.set(r.id, { id: r.id, name: r.name, email: r.email, role: r.role, department: r.department_code }));
  const deptFilter = sel.departments?.length ? inList(sel.departments) : null;
  for (const [flag, role] of [
    [sel.allHods, 'HOD'],
    [sel.allAdvisers, 'Adviser'],
  ] as const) {
    if (!flag) continue;
    add(
      db().all(
        `SELECT id, name, email, role, department_code FROM users WHERE is_active = 1 AND role = ? ${deptFilter ? `AND department_code IN ${deptFilter.sql}` : ''}`,
        role,
        ...(deptFilter?.params ?? []),
      ),
    );
  }
  if (sel.userIds?.length) {
    const l = inList(sel.userIds);
    const rows = db().all<any>(`SELECT id, name, email, role, department_code FROM users WHERE is_active = 1 AND role IN ('HOD','Adviser') AND id IN ${l.sql}`, ...l.params);
    if (rows.length !== new Set(sel.userIds).size) throw badRequest('One or more selected recipients are not active HOD or Adviser accounts.');
    add(rows);
  }
  return [...out.values()].sort((a, b) => a.role.localeCompare(b.role) || a.department.localeCompare(b.department) || a.name.localeCompare(b.name));
}

/** Guards bulk sends: the client must echo the number of recipients it previewed. */
export function assertConfirmed(recipients: Recipient[], confirmCount: unknown) {
  if (!recipients.length) throw badRequest('The selection matches no active HOD or Adviser accounts.');
  if (Number(confirmCount) !== recipients.length) {
    throw badRequest(`Please review the recipient list (${recipients.length} people) and confirm before sending.`, { recipients: recipients.length });
  }
}
