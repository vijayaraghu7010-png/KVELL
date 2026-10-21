import type { AuthUser } from './auth';
import { forbidden } from './http';

/**
 * The institution's authority order, highest first.
 *
 * This is the order of standing, not a grant of access: being higher in the list
 * does NOT give a role the records of the roles below it. Every role keeps its own
 * responsibilities and sees only what its own workflow allows, and each mandatory
 * approval stage still has to happen in sequence. The Dean's extra reach is exactly
 * the monitoring and work-assignment scope spelled out below — nothing wider.
 *
 * Principal is deliberately not in this list: it is a separate office from the Dean
 * and has its own escalation path, so the two never stand in for one another.
 */
export const AUTHORITY_ORDER = ['Dean', 'HOD', 'Adviser', 'AO', 'Warden', 'Security', 'Student'] as const;
export type AuthorityRole = (typeof AUTHORITY_ORDER)[number];

/** 1 = highest. Roles outside the order (Principal, Admin, Mess) return null. */
export function authorityRank(role: string): number | null {
  const i = AUTHORITY_ORDER.indexOf(role as AuthorityRole);
  return i === -1 ? null : i + 1;
}

export function outranks(a: string, b: string): boolean {
  const ra = authorityRank(a);
  const rb = authorityRank(b);
  return ra !== null && rb !== null && ra < rb;
}

/**
 * The only three student areas the Dean monitors. Anything else about a student —
 * complaints, outings, mess feedback, contact and guardian details, medical notes —
 * is outside the Dean's monitoring scope and stays with the roles that own it.
 */
export const DEAN_STUDENT_AREAS = ['study-participation', 'academic-performance', 'uninformed-absence'] as const;
export type DeanStudentArea = (typeof DEAN_STUDENT_AREAS)[number];

/** The student-related Warden reports the Dean may read. No staff-performance view. */
export const DEAN_WARDEN_REPORTS = ['attendance-absence', 'verified-unauthorized', 'gate-movements', 'study-sessions', 'incidents-followups'] as const;
export type DeanWardenReport = (typeof DEAN_WARDEN_REPORTS)[number];

export function assertDeanStudentArea(area: string): DeanStudentArea {
  if (!DEAN_STUDENT_AREAS.includes(area as DeanStudentArea)) {
    throw forbidden(`The Dean's student monitoring covers only ${DEAN_STUDENT_AREAS.join(', ')}. "${area}" is outside that scope.`);
  }
  return area as DeanStudentArea;
}

export function assertDeanWardenReport(type: string): DeanWardenReport {
  if (!DEAN_WARDEN_REPORTS.includes(type as DeanWardenReport)) {
    throw forbidden(`The Dean's Warden monitoring is limited to student-related reports (${DEAN_WARDEN_REPORTS.join(', ')}). "${type}" is not one of them.`);
  }
  return type as DeanWardenReport;
}

/**
 * Fields of a student record the Dean may see while monitoring. Identity enough to
 * act on, and nothing private: no phone, address, guardian contact, blood group or
 * medical notes.
 */
export const DEAN_STUDENT_FIELDS = ['id', 'name', 'regNumber', 'department', 'departmentName', 'section', 'year', 'yearNumber', 'roomNumber', 'block', 'adviserId', 'adviserName', 'enrollmentStatus'] as const;

export function deanStudentView<T extends Record<string, any>>(student: T): Partial<T> {
  const out: Record<string, any> = {};
  for (const key of DEAN_STUDENT_FIELDS) if (key in student) out[key] = student[key];
  return out as Partial<T>;
}

/** Describes the hierarchy for the portals, so the rules are visible, not folklore. */
export function authorityModel(user: AuthUser) {
  return {
    order: AUTHORITY_ORDER.map((role, i) => ({ rank: i + 1, role })),
    note: 'Authority order only. A higher rank does not grant access to the records of lower ranks; each role sees what its own workflow allows.',
    separateOffices: ['Dean', 'Principal'],
    you: { role: user.role, rank: authorityRank(user.role) },
    deanScope: {
      staffMonitoring: ['HOD', 'Adviser'],
      studentMonitoring: DEAN_STUDENT_AREAS,
      wardenMonitoring: DEAN_WARDEN_REPORTS,
      canAssignWorkTo: ['HOD', 'Adviser'],
      readOnly: 'Dean monitoring views are read-only; the Dean acts through work assignments, report requests, schedules and student follow-ups.',
      cannotBypass: 'Leave, complaint, outing and gate workflows keep every mandatory approval stage regardless of authority rank.',
    },
  };
}
