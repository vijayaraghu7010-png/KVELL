import React, { useMemo, useState } from 'react';
import type { PortalProps } from '../../App';
import { ApiError, http } from '../../services/http';
import { useAction, useResource } from '../../hooks/useApi';
import { usePortalRoute } from '../../hooks/usePortalRoute';
import { useAuth } from '../../auth/AuthContext';
import { PortalShell, NavItem } from '../common/PortalShell';
import { NotificationsPage } from '../common/Notifications';
import { AccountPage } from '../common/Account';
import { SettingsPage } from '../dean/DeanMonitoring';
import { AsyncContent, Badge, Button, Card, Checkbox, DataTable, EmptyState, FilterSelect, Modal, PageHeader, SelectField, StatusBadge, Tabs, TextArea, TextField } from '../common/ui';

const TABS = ['users', 'departments', 'class-incharges', 'complaint-config', 'settings', 'audit', 'notifications', 'profile'] as const;
type AdminRoute = (typeof TABS)[number];
const TITLES: Record<AdminRoute, string> = {
  users: 'Staff Accounts',
  departments: 'Add Department',
  'class-incharges': 'Class Incharges',
  'complaint-config': 'Complaint Categories & Workers',
  settings: 'System Settings',
  audit: 'Audit Log',
  notifications: 'Notifications',
  profile: 'Profile',
};
const ROLES = ['Warden', 'Security', 'Adviser', 'HOD', 'AO', 'Mess', 'Dean', 'Principal', 'Admin'];
type Toast = (m: string, e?: boolean) => void;

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  department: string | null;
  phone: string | null;
  designation: string | null;
  isActive: boolean;
  isDemo: boolean;
  mustChangePassword: boolean;
  lockedUntil: string | null;
  createdAt: string;
  studentId: string | null;
  isClassIncharge: boolean;
  classSection: string | null;
  /** Staff responsibility: which students this Adviser conducts sessions for. */
  studentCategory: 'Hosteller' | 'Out / Day Scholar' | null;
}

const STUDENT_CATEGORIES = ['Hosteller', 'Out / Day Scholar'];
interface StudentRow {
  id: string;
  name: string;
  regNumber: string;
  department: string;
  yearNumber: number;
  year: string;
  semester: number | null;
  roomNumber: string;
  adviserId: string | null;
  adviserName: string | null;
  section: string | null;
  enrollmentStatus: string;
  isHosteller: boolean;
  loginEmail: string | null;
  contactNumber: string;
  email: string;
  parentName: string;
  parentNumber: string;
  permanentAddress: string;
  gender: string;
}

export const AdminPortal: React.FC<PortalProps> = ({ onSignOut, onShowToast }) => {
  const { tab, navigate } = usePortalRoute<AdminRoute>('admin', TABS, 'users');
  const nav: NavItem<AdminRoute>[] = [
    { id: 'users', label: 'Staff Accounts', icon: 'manage_accounts', section: 'Provisioning' },
    { id: 'departments', label: 'Add Department', icon: 'domain_add', section: 'Provisioning' },
    { id: 'class-incharges', label: 'Class Incharges', icon: 'co_present', section: 'Provisioning' },
    { id: 'complaint-config', label: 'Complaints & Workers', icon: 'build', section: 'System' },
    { id: 'settings', label: 'System Settings', icon: 'tune', section: 'System' },
    { id: 'audit', label: 'Audit Log', icon: 'policy', section: 'System' },
    { id: 'notifications', label: 'Notifications', icon: 'notifications', section: 'Account' },
  ];
  return (
    <PortalShell
      portalLabel="Admin"
      sidebarColor="var(--kv-nav-bg)"
      activeColor="var(--kv-nav-active)"
      nav={nav}
      active={tab}
      onNavigate={(t) => navigate(t)}
      onSignOut={onSignOut}
      title={TITLES[tab]}
      notificationsTab="notifications"
      profileTab="profile"
      footerNote="System administration"
    >
      {tab === 'users' && <UsersPage onShowToast={onShowToast} />}
      {tab === 'departments' && <DepartmentsPage onShowToast={onShowToast} />}
      {tab === 'class-incharges' && <ClassInchargesPage onShowToast={onShowToast} />}
      {tab === 'complaint-config' && <ComplaintConfigPage onShowToast={onShowToast} />}
      {tab === 'settings' && <SettingsPage onShowToast={onShowToast} title="System Settings" />}
      {tab === 'audit' && <AuditPage />}
      {tab === 'notifications' && <NotificationsPage />}
      {tab === 'profile' && <AccountPage onToast={onShowToast} onSignOut={onSignOut} canChangePassword />}
    </PortalShell>
  );
};

const useDepartments = () => useResource(() => http.get<{ code: string; name: string; sections: string[]; hodName: string | null; hostelStudents: number }[]>('/meta/departments'));

// ---------------------------------------------------------------------------
const UsersPage: React.FC<{ onShowToast: Toast }> = ({ onShowToast }) => {
  const { user: me } = useAuth();
  const list = useResource(() => http.get<UserRow[]>('/admin/users'));
  const [role, setRole] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const rows = (list.data ?? []).filter((u) => u.role !== 'Student' && (!role || u.role === role));
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Staff Accounts"
        subtitle="Create accounts with a temporary password; users must change it at first sign-in. Role and department changes end the user's sessions."
        icon="manage_accounts"
        actions={
          <Button icon="person_add" onClick={() => setCreating(true)}>
            New account
          </Button>
        }
      />
      <Card>
        <AsyncContent {...list} onRetry={list.reload}>
          {() => (
            <DataTable
              rows={rows}
              rowKey={(u) => u.id}
              search={(u) => `${u.name} ${u.email} ${u.department ?? ''}`}
              onRowClick={(u) => setEditing(u)}
              toolbar={<FilterSelect label="Role" value={role} onChange={setRole} options={ROLES} />}
              columns={[
                { key: 'name', label: 'Name', render: (u) => <span className="font-semibold text-[var(--kv-heading)]">{u.name}</span> },
                { key: 'email', label: 'Email' },
                { key: 'role', label: 'Role' },
                { key: 'department', label: 'Dept', render: (u) => u.department ?? '—' },
                {
                  key: 'studentCategory',
                  label: 'Responsibility',
                  render: (u) =>
                    u.role !== 'Adviser' ? (
                      <span className="text-[var(--kv-text-muted)]">—</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        <Badge tone={u.studentCategory === 'Hosteller' ? 'green' : 'slate'}>{u.studentCategory ?? 'Not set'}</Badge>
                        {u.isClassIncharge && <Badge tone="blue">Section {u.classSection}</Badge>}
                      </span>
                    ),
                },
                {
                  key: 'state',
                  label: 'State',
                  render: (u) => (
                    <span className="flex flex-wrap gap-1">
                      <StatusBadge status={u.isActive ? 'Active' : 'Inactive'} />
                      {u.mustChangePassword && <Badge tone="amber">Temp password</Badge>}
                      {u.lockedUntil && new Date(u.lockedUntil) > new Date() && <Badge tone="red">Locked</Badge>}
                      {u.isDemo && <Badge tone="violet">Demo</Badge>}
                      {u.id === me?.id && <Badge tone="blue">You</Badge>}
                    </span>
                  ),
                },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
      {creating && (
        <UserForm
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            list.reload();
          }}
          onShowToast={onShowToast}
        />
      )}
      {editing && (
        <UserEdit
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
          onShowToast={onShowToast}
        />
      )}
    </div>
  );
};

const UserForm: React.FC<{ onClose: () => void; onSaved: () => void; onShowToast: Toast }> = ({ onClose, onSaved, onShowToast }) => {
  const depts = useDepartments();
  const [f, setF] = useState({ name: '', email: '', role: 'Adviser', department: '', phone: '', designation: '', employeeId: '', temporaryPassword: '' });
  const [isClassIncharge, setIsClassIncharge] = useState(false);
  const [section, setSection] = useState('');
  const [studentCategory, setStudentCategory] = useState('Hosteller');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const needsDept = f.role === 'HOD' || f.role === 'Adviser';
  const sections = (depts.data ?? []).find((d) => d.code === f.department)?.sections ?? ['A', 'B'];
  const save = async () => {
    const errs: Record<string, string> = {};
    if (!f.name.trim()) errs.name = 'Name is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) errs.email = 'Enter a valid email.';
    if (needsDept && !f.department) errs.department = 'Choose a department.';
    if (isClassIncharge && !section) errs.section = 'Choose the class section.';
    if (f.role === 'Adviser' && !studentCategory) errs.studentCategory = 'Choose the student category this Adviser is responsible for.';
    if (f.temporaryPassword.length < 8 || !/[A-Za-z]/.test(f.temporaryPassword) || !/\d/.test(f.temporaryPassword)) errs.temporaryPassword = '8+ characters with letters and numbers.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setPending(true);
    try {
      const res = await http.post('/admin/users', {
        ...f,
        department: f.department || undefined,
        phone: f.phone || undefined,
        designation: f.designation || undefined,
        employeeId: f.employeeId || undefined,
        isClassIncharge,
        section: isClassIncharge ? section : undefined,
        studentCategory: f.role === 'Adviser' ? studentCategory : undefined,
      });
      onShowToast(res.message || 'Account created.');
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      onShowToast(err instanceof Error ? err.message : 'Could not create the account.', true);
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal
      open
      title="New staff account"
      description="Share the temporary password with the user through a secure channel. It is not stored in readable form."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={pending} onClick={save}>
            Create account
          </Button>
        </>
      }
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <TextField label="Full name" required value={f.name} onChange={set('name')} error={errors.name} />
        <TextField label="Email (sign-in)" type="email" required value={f.email} onChange={set('email')} error={errors.email} />
        <SelectField label="Role" value={f.role} onChange={set('role')} options={ROLES} />
        <SelectField label={`Department${needsDept ? ' *' : ''}`} value={f.department} onChange={set('department')} placeholder="None" options={(depts.data ?? []).map((d) => ({ value: d.code, label: `${d.code} — ${d.name}` }))} error={errors.department} />
        <TextField label="Designation" value={f.designation} onChange={set('designation')} />
        <TextField label="Employee ID" value={f.employeeId} onChange={set('employeeId')} />
        <TextField label="Phone" value={f.phone} onChange={set('phone')} />
        <TextField label="Temporary password" type="text" autoComplete="off" required value={f.temporaryPassword} onChange={set('temporaryPassword')} error={errors.temporaryPassword} />
      </div>
      {f.role === 'Adviser' && (
        <div className="mt-4 border-t border-[var(--kv-border-soft)] pt-3 space-y-3">
          <SelectField
            label="Student category / responsibility"
            required
            value={studentCategory}
            onChange={(e) => setStudentCategory(e.target.value)}
            options={STUDENT_CATEGORIES}
            error={errors.studentCategory}
            hint="Hosteller advisers conduct hostel study sessions. This is about the Adviser's duty, not where a student lives."
          />
          <fieldset>
            <legend className="text-sm font-semibold text-[var(--kv-heading)]">Are you a Class Incharge?</legend>
            <p className="text-xs text-[var(--kv-text-muted)] mb-2">A Class Incharge is the first approver for leave requests from their section.</p>
            <div className="flex gap-4" role="radiogroup" aria-label="Are you a Class Incharge?">
              {[
                { label: 'Yes', value: true },
                { label: 'No', value: false },
              ].map((o) => (
                <label key={o.label} className="flex items-center gap-2 text-sm text-[var(--kv-heading)] cursor-pointer">
                  <input
                    type="radio"
                    name="is-class-incharge"
                    checked={isClassIncharge === o.value}
                    onChange={() => {
                      setIsClassIncharge(o.value);
                      if (!o.value) setSection('');
                    }}
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </fieldset>
          {/* The section question only appears on "Yes" — and is only sent then. */}
          {isClassIncharge && (
            <SelectField
              label="Select class section"
              required
              value={section}
              onChange={(e) => setSection(e.target.value)}
              placeholder="— choose a section —"
              options={sections.map((x: string) => ({ value: x, label: `Section ${x}` }))}
              error={errors.section}
              hint={f.department ? `Sections configured for ${f.department}.` : 'Choose a department first.'}
            />
          )}
        </div>
      )}
    </Modal>
  );
};

const UserEdit: React.FC<{ user: UserRow; onClose: () => void; onSaved: () => void; onShowToast: Toast }> = ({ user, onClose, onSaved, onShowToast }) => {
  const depts = useDepartments();
  const { user: me } = useAuth();
  const [f, setF] = useState({ name: user.name, role: user.role, department: user.department ?? '', phone: user.phone ?? '', designation: user.designation ?? '', isActive: user.isActive });
  const [isClassIncharge, setIsClassIncharge] = useState(user.isClassIncharge);
  const [section, setSection] = useState(user.classSection ?? '');
  const [studentCategory, setStudentCategory] = useState<string>(user.studentCategory ?? 'Hosteller');
  const [temp, setTemp] = useState('');
  const { run, pending } = useAction(onShowToast);
  const self = user.id === me?.id;
  return (
    <Modal
      open
      title={user.name}
      description={user.email}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            loading={pending}
            onClick={async () => {
              const r = await run(() =>
                http.patch(`/admin/users/${user.id}`, {
                  name: f.name,
                  role: f.role,
                  department: f.department || undefined,
                  phone: f.phone || undefined,
                  designation: f.designation || undefined,
                  isActive: f.isActive,
                  isClassIncharge: f.role === 'Adviser' ? isClassIncharge : false,
                  section: f.role === 'Adviser' && isClassIncharge ? section : undefined,
                  studentCategory: f.role === 'Adviser' ? studentCategory : undefined,
                }),
              );
              if (r) onSaved();
            }}
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <TextField label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          {user.role !== 'Student' && <SelectField label="Role" value={f.role} disabled={self} onChange={(e) => setF({ ...f, role: e.target.value })} options={ROLES} />}
          <SelectField label="Department" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} placeholder="None" options={(depts.data ?? []).map((d) => d.code)} />
          <TextField label="Designation" value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} />
          <TextField label="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <div className="flex items-end pb-2">
            <Checkbox label="Account active" checked={f.isActive} onChange={(v) => !self && setF({ ...f, isActive: v })} hint={self ? 'You cannot deactivate yourself.' : undefined} />
          </div>
        </div>
        {f.role === 'Adviser' && (
          <div className="border-t border-[var(--kv-border-soft)] pt-3 space-y-3">
            <SelectField
              label="Student category / responsibility"
              value={studentCategory}
              onChange={(e) => setStudentCategory(e.target.value)}
              options={STUDENT_CATEGORIES}
              hint="Only a Hosteller Adviser can be assigned hostel study sessions."
            />
            <Checkbox
              label="Class Incharge"
              checked={isClassIncharge}
              onChange={(v) => {
                setIsClassIncharge(v);
                if (!v) setSection('');
              }}
              hint="First approver for leave requests from their section."
            />
            {isClassIncharge && (
              <SelectField
                label="Class section"
                value={section}
                onChange={(e) => setSection(e.target.value)}
                placeholder="— choose a section —"
                options={((depts.data ?? []).find((d) => d.code === f.department)?.sections ?? ['A', 'B']).map((x: string) => ({ value: x, label: `Section ${x}` }))}
                hint="Reassigning a section that is already held replaces the current Class Incharge."
              />
            )}
          </div>
        )}
        <div className="border-t border-[var(--kv-border-soft)] pt-3 flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px]">
            <TextField label="Set a temporary password" value={temp} onChange={(e) => setTemp(e.target.value)} hint="Signs the user out everywhere and forces a password change." />
          </div>
          <Button
            variant="secondary"
            icon="lock_reset"
            loading={pending}
            disabled={temp.length < 8}
            onClick={async () => {
              const r = await run(() => http.post(`/admin/users/${user.id}/reset-password`, { temporaryPassword: temp }));
              if (r) setTemp('');
            }}
          >
            Reset password
          </Button>
        </div>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
const DepartmentsPage: React.FC<{ onShowToast: Toast }> = ({ onShowToast }) => {
  const list = useDepartments();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const { run, pending } = useAction(onShowToast);
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="Add Department" subtitle="HODs are assigned by giving a staff account the HOD role and a department (one active HOD per department)." icon="domain" />
      <Card className="mb-4">
        <div className="grid sm:grid-cols-[140px_1fr_auto] gap-3 items-end">
          <TextField label="Code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. CSE" />
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Computer Science & Engineering" />
          <Button
            icon="add"
            loading={pending}
            disabled={!code || !name}
            onClick={async () => {
              const r = await run(() => http.post('/admin/departments', { code, name }));
              if (r) {
                setCode('');
                setName('');
                list.reload();
              }
            }}
          >
            Add
          </Button>
        </div>
      </Card>
      <Card>
        <AsyncContent {...list} onRetry={list.reload}>
          {(rows) => (
            <DataTable
              rows={rows}
              rowKey={(d) => d.code}
              emptyTitle="No departments yet"
              columns={[
                { key: 'code', label: 'Code' },
                { key: 'name', label: 'Name' },
                { key: 'hodName', label: 'HOD', render: (d) => d.hodName ?? <Badge tone="amber">Not assigned</Badge> },
                { key: 'hostelStudents', label: 'Hostel students' },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
    </div>
  );
};

const AuditPage: React.FC = () => {
  const list = useResource(() => http.get<{ id: number; at: string; actor: string; role: string | null; action: string; entityType: string | null; entityId: string | null; details: string | null; ip: string | null }[]>('/admin/audit?limit=1000'));
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader title="Audit Log" subtitle="Security-relevant actions across the system (latest 1000)." icon="policy" />
      <Card>
        <AsyncContent {...list} onRetry={list.reload}>
          {(rows) => (
            <DataTable
              rows={rows}
              rowKey={(r) => String(r.id)}
              pageSize={25}
              search={(r) => `${r.actor} ${r.action} ${r.entityType ?? ''} ${r.entityId ?? ''}`}
              columns={[
                { key: 'at', label: 'When', sortValue: (r) => r.id },
                { key: 'actor', label: 'Actor', render: (r) => `${r.actor}${r.role ? ` (${r.role})` : ''}` },
                { key: 'action', label: 'Action', render: (r) => <span className="font-mono text-xs">{r.action}</span> },
                { key: 'entity', label: 'Record', render: (r) => (r.entityType ? `${r.entityType} ${r.entityId ?? ''}` : '—') },
                { key: 'details', label: 'Details', render: (r) => <span className="text-xs break-all line-clamp-2 max-w-[320px]">{r.details ?? ''}</span> },
              ]}
            />
          )}
        </AsyncContent>
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Class Incharge assignment: one teacher per department + section
// ---------------------------------------------------------------------------
interface InchargeSlot {
  department: string;
  departmentName: string;
  section: string;
  incharge: { id: string; userId: string; name: string; email: string; phone: string; section: string; studentCount: number } | null;
}
interface InchargeData {
  departments: { code: string; name: string; sections: string[] }[];
  slots: InchargeSlot[];
  assignments: { id: string; userId: string; name: string; department: string; section: string; studentCount: number }[];
  teachers: { id: string; name: string; email: string; department: string; currentSection: string | null }[];
}

const ClassInchargesPage: React.FC<{ onShowToast: Toast }> = ({ onShowToast }) => {
  const data = useResource(() => http.get<InchargeData>('/admin/class-incharges'));
  const { run, pending } = useAction(onShowToast);
  const [slot, setSlot] = useState<InchargeSlot | null>(null);
  const [sectionsFor, setSectionsFor] = useState<{ code: string; value: string } | null>(null);

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Class Incharges"
        subtitle="Each department section has one Class Incharge, and they are the first approver for that section's leave requests. A teacher holds at most one section."
        icon="co_present"
      />
      <AsyncContent {...data} onRetry={data.reload}>
        {(d) => (
          <div className="space-y-4">
            <Card title="Section assignments">
              <DataTable
                rows={d.slots}
                rowKey={(r) => `${r.department}-${r.section}`}
                search={(r) => `${r.department} ${r.section} ${r.incharge?.name ?? ''}`}
                onRowClick={(r) => setSlot(r)}
                emptyTitle="No departments configured"
                columns={[
                  { key: 'department', label: 'Department', render: (r) => <span className="font-semibold text-[var(--kv-heading)]">{r.department}</span> },
                  { key: 'section', label: 'Section', render: (r) => `Section ${r.section}` },
                  { key: 'incharge', label: 'Class Incharge', render: (r) => (r.incharge ? r.incharge.name : <span className="text-[var(--kv-text-muted)]">Not assigned</span>) },
                  { key: 'email', label: 'Contact', render: (r) => (r.incharge ? `${r.incharge.email}${r.incharge.phone ? ` · ${r.incharge.phone}` : ''}` : '—') },
                  { key: 'studentCount', label: 'Students', render: (r) => r.incharge?.studentCount ?? 0 },
                  {
                    key: 'state',
                    label: 'State',
                    render: (r) => (r.incharge ? <StatusBadge status="Assigned" /> : <Badge tone="amber">Leave requests blocked</Badge>),
                  },
                ]}
              />
            </Card>

            <Card title="Sections per department" actions={<span className="text-xs text-[var(--kv-text-muted)]">A section can only be removed once no student is in it.</span>}>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {d.departments.map((dept) => (
                  <div key={dept.code} className="border border-[var(--kv-border)] rounded-xl p-3 space-y-2">
                    <p className="text-sm font-semibold text-[var(--kv-heading)]">
                      {dept.code} <span className="font-normal text-[var(--kv-text-muted)]">{dept.name}</span>
                    </p>
                    <div className="flex items-end gap-2">
                      <TextField
                        label="Sections"
                        value={sectionsFor?.code === dept.code ? sectionsFor.value : dept.sections.join(',')}
                        onChange={(e) => setSectionsFor({ code: dept.code, value: e.target.value })}
                        hint="Comma separated, e.g. A,B"
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={pending}
                        disabled={!sectionsFor || sectionsFor.code !== dept.code}
                        onClick={async () => {
                          const r = await run(() => http.patch(`/admin/departments/${dept.code}`, { sections: sectionsFor!.value }));
                          if (r) {
                            setSectionsFor(null);
                            data.reload();
                          }
                        }}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </AsyncContent>

      {slot && data.data && (
        <InchargeAssignModal
          slot={slot}
          teachers={data.data.teachers.filter((t) => t.department === slot.department)}
          onClose={() => setSlot(null)}
          onSaved={() => {
            setSlot(null);
            data.reload();
          }}
          onShowToast={onShowToast}
        />
      )}
    </div>
  );
};

const InchargeAssignModal: React.FC<{
  slot: InchargeSlot;
  teachers: InchargeData['teachers'];
  onClose: () => void;
  onSaved: () => void;
  onShowToast: Toast;
}> = ({ slot, teachers, onClose, onSaved, onShowToast }) => {
  const { run, pending } = useAction(onShowToast);
  const [userId, setUserId] = useState(slot.incharge?.userId ?? '');
  return (
    <Modal
      open
      title={`${slot.department} Section ${slot.section}`}
      description={slot.incharge ? `Currently ${slot.incharge.name}` : 'No Class Incharge assigned yet'}
      onClose={onClose}
      footer={
        <>
          {slot.incharge && (
            <Button
              variant="danger"
              loading={pending}
              onClick={async () => {
                const r = await run(() => http.del(`/admin/class-incharges/${slot.incharge!.userId}`));
                if (r) onSaved();
              }}
            >
              Remove assignment
            </Button>
          )}
          <Button
            loading={pending}
            disabled={!userId}
            onClick={async () => {
              const r = await run(() => http.post('/admin/class-incharges', { userId, department: slot.department, section: slot.section, replace: true }));
              if (r) onSaved();
            }}
          >
            {slot.incharge ? 'Replace Class Incharge' : 'Assign Class Incharge'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <SelectField
          label="Teacher"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="— choose a teacher —"
          options={teachers.map((t) => ({ value: t.id, label: `${t.name}${t.currentSection ? ` (currently Section ${t.currentSection})` : ''}` }))}
          hint={teachers.length ? 'Only Adviser/Teacher accounts of this department are listed.' : `No active Adviser accounts exist for ${slot.department}.`}
        />
        <p className="text-xs text-[var(--kv-text-muted)]">
          Assigning a teacher who already holds another section moves them; the section they leave becomes unassigned, and leave requests from it cannot be submitted until it is filled again.
        </p>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Complaint categories, resolution targets and workers
// ---------------------------------------------------------------------------
interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  defaultPriority: string;
  resolutionHours: number;
  workerCategory: string | null;
  routesToAO: boolean;
  isActive: boolean;
  targets: Record<string, number>;
}
interface WorkerRow {
  id: string;
  name: string;
  role: string;
  phone: string;
  category: string;
  isActive: boolean;
}
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

const ComplaintConfigPage: React.FC<{ onShowToast: Toast }> = ({ onShowToast }) => {
  const [view, setView] = useState('categories');
  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Complaint Categories & Workers"
        subtitle="Categories carry their own resolution target per priority and point at the worker trade that handles them. Changes apply to complaints raised afterwards; deadlines already recorded stay as they were."
        icon="build"
      />
      <div className="mb-3">
        <Tabs active={view} onChange={setView} tabs={[{ id: 'categories', label: 'Categories & targets' }, { id: 'workers', label: 'Workers' }]} />
      </div>
      {view === 'categories' ? <CategoriesPanel onShowToast={onShowToast} /> : <WorkersPanel onShowToast={onShowToast} />}
    </div>
  );
};

const CategoriesPanel: React.FC<{ onShowToast: Toast }> = ({ onShowToast }) => {
  const list = useResource(() => http.get<CategoryRow[]>('/admin/complaint-categories'));
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <Card
      title="Categories"
      actions={
        <Button size="sm" icon="add" onClick={() => setCreating(true)}>
          New category
        </Button>
      }
    >
      <AsyncContent {...list} onRetry={list.reload}>
        {(rows) => (
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            search={(r) => `${r.name} ${r.workerCategory ?? ''}`}
            onRowClick={(r) => setEditing(r)}
            emptyTitle="No categories configured"
            columns={[
              { key: 'name', label: 'Category', render: (r) => <span className="font-semibold text-[var(--kv-heading)]">{r.name}</span> },
              { key: 'defaultPriority', label: 'Default priority' },
              {
                key: 'targets',
                label: 'Resolution target (hours)',
                render: (r) => <span className="text-xs">{PRIORITIES.map((p) => `${p}: ${r.targets[p] ?? r.resolutionHours}`).join(' · ')}</span>,
              },
              { key: 'workerCategory', label: 'Worker trade', render: (r) => r.workerCategory ?? '—' },
              {
                key: 'routesToAO',
                label: 'Routing',
                render: (r) => (r.routesToAO ? <Badge tone="violet">AO review</Badge> : <Badge tone="slate">Warden</Badge>),
              },
              { key: 'isActive', label: 'State', render: (r) => <StatusBadge status={r.isActive ? 'Active' : 'Inactive'} /> },
            ]}
          />
        )}
      </AsyncContent>
      {(editing || creating) && (
        <CategoryModal
          category={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            setEditing(null);
            setCreating(false);
            list.reload();
          }}
          onShowToast={onShowToast}
        />
      )}
    </Card>
  );
};

const CategoryModal: React.FC<{ category: CategoryRow | null; onClose: () => void; onSaved: () => void; onShowToast: Toast }> = ({ category, onClose, onSaved, onShowToast }) => {
  const { run, pending } = useAction(onShowToast);
  const [f, setF] = useState({
    name: category?.name ?? '',
    description: category?.description ?? '',
    defaultPriority: category?.defaultPriority ?? 'Medium',
    workerCategory: category?.workerCategory ?? '',
    routesToAO: category?.routesToAO ?? false,
    isActive: category?.isActive ?? true,
  });
  const [targets, setTargets] = useState<Record<string, string>>(
    Object.fromEntries(PRIORITIES.map((p) => [p, String(category?.targets[p] ?? category?.resolutionHours ?? 24)])),
  );
  const save = async () => {
    const numericTargets = Object.fromEntries(Object.entries(targets).map(([k, v]) => [k, Number(v)]));
    const body = { ...f, workerCategory: f.workerCategory || undefined, targets: numericTargets, resolutionHours: numericTargets[f.defaultPriority] };
    const r = category ? await run(() => http.patch(`/admin/complaint-categories/${category.id}`, body)) : await run(() => http.post('/admin/complaint-categories', body));
    if (r) onSaved();
  };
  return (
    <Modal
      open
      title={category ? category.name : 'New complaint category'}
      description="The resolution target is set per priority, so one category can have different deadlines."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={pending} onClick={save}>
            {category ? 'Save changes' : 'Create category'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <TextField label="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <SelectField label="Default priority" value={f.defaultPriority} onChange={(e) => setF({ ...f, defaultPriority: e.target.value })} options={PRIORITIES} />
          <TextField label="Worker trade" value={f.workerCategory} onChange={(e) => setF({ ...f, workerCategory: e.target.value })} hint="Matches the worker's category, e.g. Plumbing." />
          <TextArea label="Description" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--kv-text-muted)] mb-2">Resolution target per priority (hours)</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {PRIORITIES.map((p) => (
              <TextField key={p} label={p} type="number" min={0.25} step={0.25} value={targets[p]} onChange={(e) => setTargets({ ...targets, [p]: e.target.value })} />
            ))}
          </div>
        </div>
        <Checkbox label="Route to the Administrative Officer" checked={f.routesToAO} onChange={(v) => setF({ ...f, routesToAO: v })} hint="Use for complaints about the Warden; the Warden never sees them." />
        {category && <Checkbox label="Available to students" checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} />}
      </div>
    </Modal>
  );
};

const WorkersPanel: React.FC<{ onShowToast: Toast }> = ({ onShowToast }) => {
  const list = useResource(() => http.get<WorkerRow[]>('/admin/workers'));
  const { run, pending } = useAction(onShowToast);
  const [f, setF] = useState({ name: '', role: '', phone: '', category: '' });
  return (
    <div className="space-y-4">
      <Card title="Add a worker">
        <div className="grid sm:grid-cols-4 gap-3 items-end">
          <TextField label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <TextField label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} />
          <TextField label="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} hint="Shown only to the Warden and AO." />
          <TextField label="Category / trade" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
        </div>
        <div className="mt-3">
          <Button
            icon="person_add"
            loading={pending}
            disabled={!f.name || !f.role || !f.phone || !f.category}
            onClick={async () => {
              const r = await run(() => http.post('/admin/workers', f));
              if (r) {
                setF({ name: '', role: '', phone: '', category: '' });
                list.reload();
              }
            }}
          >
            Add worker
          </Button>
        </div>
      </Card>
      <Card title="Workers">
        <AsyncContent {...list} onRetry={list.reload}>
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState icon="engineering" title="No workers configured" message="Add the workers the Warden can assign to complaints." />
            ) : (
              <DataTable
                rows={rows}
                rowKey={(r) => r.id}
                search={(r) => `${r.name} ${r.category} ${r.role}`}
                emptyTitle="No workers configured"
                columns={[
                  { key: 'name', label: 'Name', render: (r) => <span className="font-semibold text-[var(--kv-heading)]">{r.name}</span> },
                  { key: 'role', label: 'Role' },
                  { key: 'category', label: 'Category / trade' },
                  { key: 'phone', label: 'Phone', render: (r) => <span className="font-mono text-xs">{r.phone}</span> },
                  { key: 'isActive', label: 'State', render: (r) => <StatusBadge status={r.isActive ? 'Active' : 'Inactive'} /> },
                  {
                    key: 'actions',
                    label: '',
                    render: (r) => (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={pending}
                        onClick={async (e) => {
                          e.stopPropagation();
                          const res = await run(() => http.patch(`/admin/workers/${r.id}`, { isActive: !r.isActive }));
                          if (res) list.reload();
                        }}
                      >
                        {r.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    ),
                  },
                ]}
              />
            )
          }
        </AsyncContent>
      </Card>
    </div>
  );
};
