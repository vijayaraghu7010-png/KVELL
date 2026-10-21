/** Portal (URL segment) that serves each role. Roles without a portal get an explanatory page. */
export const PORTAL_BY_ROLE: Record<string, string | null> = {
  Student: 'student',
  Warden: 'warden',
  Security: 'security',
  Adviser: 'adviser',
  HOD: 'hod',
  AO: 'ao',
  Mess: 'mess',
  Dean: 'dean',
  Admin: 'admin',
  Principal: null,
};

export const portalForRole = (role: string) => PORTAL_BY_ROLE[role] ?? null;
