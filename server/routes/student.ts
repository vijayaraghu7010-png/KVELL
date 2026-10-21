import { Router } from 'express';
import { db } from '../db/database';
import { requireRole } from '../lib/auth';
import { badRequest, conflict, created, notFound, ok, route } from '../lib/http';
import { audit, notify, recordEvent, usersWithRole } from '../lib/records';
import { getStudent, ownStudentId } from '../lib/scope';
import { addDays, fmtDate, fmtDateTime, localDate, nextCode, nowIso, uid, zonedIso } from '../lib/util';
import { Validator } from '../lib/validate';
import { changeComplaintStatus, COMPLAINT_PRIORITIES, COMPLAINT_SELECT, createComplaint, listCategories, mapComplaint } from '../services/complaints';
import { hodOf, inchargeFor } from '../services/classIncharge';
import { myAttendanceCode, scanSessionQr, studentQr, studentSessions } from '../services/studySessions';
import { issueParentApproval, locationHistory, parentApprovalHistory, recordTracking, TRACKING_STATUSES, trackingView } from '../services/outings';
import { integrationStatus } from '../services/whatsapp';
import {
  cancelLeave,
  createLeave,
  getOuting,
  LEAVE_SELECT,
  LEAVE_TYPES,
  mapLeave,
  mapOuting,
  mapOutpass,
  OUTING_SELECT,
  OUTING_TYPES,
  OUTPASS_SELECT,
  validateOutingWindow,
} from '../services/requests';

const router = Router();
router.use(requireRole('Student'));

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
router.get(
  '/profile',
  route((req, res) => {
    const studentId = ownStudentId(req.user!);
    const s = getStudent(req.user!, studentId);
    const row = db().get<any>('SELECT section, department_code FROM students WHERE id = ?', studentId)!;
    const incharge = inchargeFor(row.department_code, row.section);
    const hod = hodOf(row.department_code);
    ok(res, {
      ...s,
      email: req.user!.email,
      block: s.block || 'Unallocated',
      section: row.section || null,
      sectionLabel: row.section ? 'Section ' + row.section : 'Not assigned',
      classIncharge: incharge ? { name: incharge.name, email: incharge.email, phone: incharge.phone || '' } : null,
      classInchargeName: incharge?.name ?? 'Not assigned',
      hodName: hod?.name ?? 'Not assigned',
      mentor: s.adviserName || 'Not assigned',
      avatarInitials: s.name
        .split(/\s+/)
        .map((p: string) => p[0])
        .join('')
        .slice(0, 2)
        .toUpperCase(),
    });
  }),
);

router.patch(
  '/profile',
  route((req, res) => {
    const studentId = ownStudentId(req.user!);
    const v = new Validator(req.body);
    const phone = v.string('phone', { required: false, max: 30, label: 'Phone' });
    const address = v.string('address', { required: false, max: 300, label: 'Address' });
    v.check(!phone || /^[+\d\s()-]{6,30}$/.test(phone), 'phone', 'Phone number contains invalid characters.');
    v.done();
    db().run('UPDATE students SET phone = COALESCE(?, phone), address = COALESCE(?, address), updated_at = ? WHERE id = ?', phone ?? null, address ?? null, nowIso(), studentId);
    audit(req, 'student.profile_updated', 'student', studentId, { phone: phone !== undefined, address: address !== undefined });
    ok(res, getStudent(req.user!, studentId), { message: 'Profile updated.' });
  }),
);

router.get(
  '/dashboard',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    const count = (sql: string, ...p: unknown[]) => db().get<{ c: number }>(sql, ...p)!.c;
    const today = localDate();
    ok(res, {
      pendingLeaves: count(`SELECT COUNT(*) AS c FROM leave_requests WHERE student_id = ? AND status IN ('Pending Class Incharge','Pending HOD','Pending Warden')`, sid),
      pendingOutings: count(`SELECT COUNT(*) AS c FROM outing_requests WHERE student_id = ? AND status IN ('Parent Approval Pending','Pending Warden')`, sid),
      openComplaints: count(`SELECT COUNT(*) AS c FROM complaints WHERE student_id = ? AND status != 'Resolved'`, sid),
      activeOutpasses: count(`SELECT COUNT(*) AS c FROM outpasses WHERE student_id = ? AND status IN ('Active','Out') AND valid_until >= ?`, sid, nowIso()),
      todayAttendance: db().get<any>(`SELECT status FROM attendance_records WHERE student_id = ? AND att_date = ? ORDER BY recorded_at DESC LIMIT 1`, sid, today)?.status ?? null,
      upcomingStudySessions: db()
        .all<any>(
          `SELECT ss.id, ss.title, ss.session_date, ss.start_time, ss.end_time, ss.location FROM study_sessions ss
           JOIN students s ON s.id = ?
           LEFT JOIN rooms r ON r.id = s.room_id
           WHERE ss.status = 'Scheduled' AND ss.session_date >= ?
             AND (ss.block IS NULL OR ss.block = r.block) AND (ss.department_code IS NULL OR ss.department_code = s.department_code) AND (ss.year IS NULL OR ss.year = s.year)
           ORDER BY ss.session_date, ss.start_time LIMIT 5`,
          sid,
          today,
        )
        .map((x) => ({ id: x.id, title: x.title, date: fmtDate(x.session_date), time: `${x.start_time} – ${x.end_time}`, location: x.location })),
    });
  }),
);

// ---------------------------------------------------------------------------
// Complaints and drafts
// ---------------------------------------------------------------------------
router.get(
  '/complaints',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    ok(res, db().all(`SELECT ${COMPLAINT_SELECT} WHERE c.student_id = ? ORDER BY c.created_at DESC`, sid).map((c) => mapComplaint(c, true)));
  }),
);

/** Categories, their default priority and the resolution target for each priority. */
router.get(
  '/complaint-categories',
  route((_req, res) => ok(res, listCategories())),
);

router.post(
  '/complaints',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    const v = new Validator(req.body);
    const categoryId = v.string('categoryId', { max: 80, label: 'Category' });
    const title = v.string('title', { min: 5, max: 200, label: 'Title' });
    const description = v.string('description', { min: 10, max: 2000, label: 'Description' });
    const location = v.string('location', { max: 200, label: 'Location' });
    const priority = v.oneOf('priority', COMPLAINT_PRIORITIES, { required: false, label: 'Priority' });
    const fileName = v.string('fileName', { required: false, max: 200 });
    const draftId = v.string('draftId', { required: false, max: 80 });
    v.done();
    const complaint = createComplaint(req.user!, sid, { categoryId: categoryId!, title: title!, description: description!, location: location!, priority, fileName });
    if (draftId) db().run('DELETE FROM complaint_drafts WHERE id = ? AND student_id = ?', draftId, sid);
    audit(req, 'complaint.created', 'complaint', complaint.id);
    created(
      res,
      complaint,
      complaint.isAboutWarden
        ? `Complaint ${complaint.id} registered and sent to the Administrative Officer for review.`
        : `Complaint ${complaint.id} registered. Target resolution by ${complaint.deadlineDisplay}.`,
    );
  }),
);

/** A student may reopen their own resolved complaint inside the configured window. */
router.post(
  '/complaints/:id/reopen',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    const v = new Validator(req.body);
    const note = v.string('note', { min: 5, max: 500, label: 'Reason' });
    v.done();
    const row = db().get<any>('SELECT student_id FROM complaints WHERE id = ?', req.params.id);
    if (!row || row.student_id !== sid) throw notFound('Complaint');
    const complaint = changeComplaintStatus(req.user!, req.params.id, 'Reopened', { note });
    audit(req, 'complaint.reopened', 'complaint', complaint.id);
    ok(res, complaint, { message: `Complaint ${complaint.id} reopened.` });
  }),
);

const mapComplaintDraft = (d: any) => ({
  id: d.id,
  title: d.title,
  category: d.category || '',
  categoryId: d.category || '',
  urgency: d.urgency || '',
  priority: d.priority || '',
  location: d.location || '',
  description: d.description || '',
  fileName: d.file_name || undefined,
  lastEdited: fmtDateTime(d.updated_at),
});

router.get(
  '/complaint-drafts',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    ok(res, db().all('SELECT * FROM complaint_drafts WHERE student_id = ? ORDER BY updated_at DESC', sid).map(mapComplaintDraft));
  }),
);

router.put(
  '/complaint-drafts/:id',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    const v = new Validator(req.body);
    const title = v.string('title', { max: 200, label: 'Title' });
    const category = v.string('category', { required: false, max: 60 });
    const urgency = v.string('urgency', { required: false, max: 40 });
    const priority = v.string('priority', { required: false, max: 20 });
    const location = v.string('location', { required: false, max: 200 });
    const description = v.string('description', { required: false, max: 2000 });
    const fileName = v.string('fileName', { required: false, max: 200 });
    v.done();
    const id = req.params.id.startsWith('new') ? uid('cdr') : req.params.id;
    const existing = db().get<any>('SELECT student_id FROM complaint_drafts WHERE id = ?', id);
    if (existing && existing.student_id !== sid) throw notFound('Draft');
    db().run(
      `INSERT INTO complaint_drafts (id, student_id, title, category, urgency, priority, location, description, file_name, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, category = excluded.category, urgency = excluded.urgency, priority = excluded.priority,
         location = excluded.location, description = excluded.description, file_name = excluded.file_name, updated_at = excluded.updated_at`,
      id,
      sid,
      title,
      category ?? null,
      urgency ?? null,
      priority ?? null,
      location ?? null,
      description ?? null,
      fileName ?? null,
      nowIso(),
    );
    ok(res, mapComplaintDraft(db().get('SELECT * FROM complaint_drafts WHERE id = ?', id)), { message: 'Draft saved.' });
  }),
);

router.delete(
  '/complaint-drafts/:id',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    const r = db().run('DELETE FROM complaint_drafts WHERE id = ? AND student_id = ?', req.params.id, sid);
    if (!r.changes) throw notFound('Draft');
    ok(res, null, { message: 'Draft deleted.' });
  }),
);

// ---------------------------------------------------------------------------
// Leave requests and drafts
// ---------------------------------------------------------------------------
router.get(
  '/leave-requests',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    ok(res, db().all(`SELECT ${LEAVE_SELECT} WHERE l.student_id = ? ORDER BY l.created_at DESC`, sid).map((l) => mapLeave(l, true)));
  }),
);

router.post(
  '/leave-requests',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    const v = new Validator(req.body);
    const leaveType = v.oneOf('type', LEAVE_TYPES, { label: 'Leave type' });
    const fromDate = v.date('fromDate', { label: 'From date' });
    const toDate = v.date('toDate', { label: 'To date' });
    const reason = v.string('reason', { min: 10, max: 1000, label: 'Reason' });
    const address = v.string('addressDuringLeave', { required: false, max: 300 });
    const fileName = v.string('fileName', { required: false, max: 200 });
    const draftId = v.string('draftId', { required: false, max: 80 });
    const departureTime = v.time('departureTime', { required: false, label: 'Departure time' });
    const returnTime = v.time('returnTime', { required: false, label: 'Expected return time' });
    v.done();
    const leave = createLeave(req.user!, sid, {
      leaveType: leaveType!,
      fromDate: fromDate!,
      toDate: toDate!,
      reason: reason!,
      address,
      documentName: fileName,
      departureAt: departureTime ? zonedIso(fromDate!, departureTime + ':00') : undefined,
      returnAt: returnTime ? zonedIso(toDate!, returnTime + ':00') : undefined,
    });
    if (draftId) db().run('DELETE FROM leave_drafts WHERE id = ? AND student_id = ?', draftId, sid);
    audit(req, 'leave.created', 'leave_request', leave.id);
    created(res, leave, `Leave request ${leave.id} submitted for review.`);
  }),
);

router.post(
  '/leave-requests/:id/cancel',
  route((req, res) => {
    ownStudentId(req.user!);
    const leave = cancelLeave(req.user!, req.params.id);
    audit(req, 'leave.cancelled', 'leave_request', leave.id);
    ok(res, leave, { message: `Leave request ${leave.id} cancelled.` });
  }),
);

const mapLeaveDraft = (d: any) => ({
  id: d.id,
  title: d.title,
  type: d.leave_type || '',
  fromDate: d.from_date || '',
  toDate: d.to_date || '',
  fromDateDisplay: d.from_date ? fmtDate(d.from_date) : '',
  toDateDisplay: d.to_date ? fmtDate(d.to_date) : '',
  reason: d.reason || '',
  fileName: d.file_name || undefined,
  lastEdited: fmtDateTime(d.updated_at),
});

router.get(
  '/leave-drafts',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    ok(res, db().all('SELECT * FROM leave_drafts WHERE student_id = ? ORDER BY updated_at DESC', sid).map(mapLeaveDraft));
  }),
);

router.put(
  '/leave-drafts/:id',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    const v = new Validator(req.body);
    const title = v.string('title', { max: 200, label: 'Title' });
    const leaveType = v.string('type', { required: false, max: 60 });
    const fromDate = v.date('fromDate', { required: false });
    const toDate = v.date('toDate', { required: false });
    const reason = v.string('reason', { required: false, max: 1000 });
    const fileName = v.string('fileName', { required: false, max: 200 });
    v.done();
    const id = req.params.id.startsWith('new') ? uid('ldr') : req.params.id;
    const existing = db().get<any>('SELECT student_id FROM leave_drafts WHERE id = ?', id);
    if (existing && existing.student_id !== sid) throw notFound('Draft');
    db().run(
      `INSERT INTO leave_drafts (id, student_id, title, leave_type, from_date, to_date, reason, file_name, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, leave_type = excluded.leave_type, from_date = excluded.from_date, to_date = excluded.to_date,
         reason = excluded.reason, file_name = excluded.file_name, updated_at = excluded.updated_at`,
      id,
      sid,
      title,
      leaveType ?? null,
      fromDate ?? null,
      toDate ?? null,
      reason ?? null,
      fileName ?? null,
      nowIso(),
    );
    ok(res, mapLeaveDraft(db().get('SELECT * FROM leave_drafts WHERE id = ?', id)), { message: 'Draft saved.' });
  }),
);

router.delete(
  '/leave-drafts/:id',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    const r = db().run('DELETE FROM leave_drafts WHERE id = ? AND student_id = ?', req.params.id, sid);
    if (!r.changes) throw notFound('Draft');
    ok(res, null, { message: 'Draft deleted.' });
  }),
);

// ---------------------------------------------------------------------------
// Outing requests (drafts are outing requests with status Draft)
// ---------------------------------------------------------------------------
router.get(
  '/outing-requests',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    ok(res, db().all(`SELECT ${OUTING_SELECT} WHERE o.student_id = ? AND o.status != 'Cancelled' ORDER BY o.created_at DESC`, sid).map((o) => mapOuting(o, true)));
  }),
);

function readOuting(body: any, asDraft: boolean) {
  const v = new Validator(body);
  const destination = v.string('destination', { max: 200, label: 'Destination', required: !asDraft });
  const reason = v.string('reason', { max: 500, label: 'Reason', required: !asDraft, min: asDraft ? 0 : 5 });
  const outAt = v.dateTime('outAt', { label: 'Departure time', required: !asDraft });
  const returnAt = v.dateTime('expectedReturnAt', { label: 'Expected return', required: !asDraft });
  const outingType = v.oneOf('outingType', OUTING_TYPES, { required: false, label: 'Outing type' }) ?? 'Personal';
  // Location sharing is consented to up front; nothing is collected without it.
  const locationConsent = body?.locationConsent === undefined ? false : v.bool('locationConsent');
  // Where the student is when they raise the request. Required on submission: the
  // guardian approves on the strength of knowing where their child actually is.
  const latitude = v.number('latitude', { required: false, min: -90, max: 90, label: 'Latitude' });
  const longitude = v.number('longitude', { required: false, min: -180, max: 180, label: 'Longitude' });
  const accuracyM = v.number('accuracyM', { required: false, min: 0, max: 100000, label: 'Location accuracy' });
  v.done();
  if (!asDraft && !locationConsent) {
    throw badRequest('Location sharing consent is required for an outing request.', { fields: { locationConsent: 'Tick the consent box to continue.' } });
  }
  const hasFix = latitude !== undefined && longitude !== undefined;
  if (!asDraft && !hasFix) {
    throw badRequest('Your current location is required before an outing request can be sent to your parent or guardian.', {
      fields: { latitude: 'Add your current location to continue.' },
    });
  }
  return { destination, reason, outAt, returnAt, outingType, locationConsent, latitude: hasFix ? latitude : undefined, longitude: hasFix ? longitude : undefined, accuracyM: hasFix ? accuracyM : undefined };
}

/** The guardian contact the approval request will go to, taken from the profile. */
function guardianFor(studentId: string) {
  const row = db().get<any>('SELECT parent_name, parent_phone FROM students WHERE id = ?', studentId)!;
  if (!row.parent_phone) {
    throw badRequest('Your profile has no parent/guardian phone number, so the approval request cannot be sent. Ask the hostel office to add one.', {
      fields: { parentPhone: 'Parent/guardian contact is missing from your profile.' },
    });
  }
  return row;
}

router.post(
  '/outing-requests',
  route(async (req, res) => {
    const sid = ownStudentId(req.user!);
    const asDraft = req.body?.status === 'Draft';
    const o = readOuting(req.body, asDraft);
    if (!asDraft) {
      validateOutingWindow(o.outAt!, o.returnAt!, sid);
      guardianFor(sid);
    }
    const id = db().transaction(() => {
      const newId = nextCode('OUT');
      const now = nowIso();
      // Drafts may be incomplete; store placeholders that satisfy constraints until submission.
      const outAt = o.outAt ?? now;
      const returnAt = o.returnAt && o.returnAt > outAt ? o.returnAt : new Date(Date.parse(outAt) + 3_600_000).toISOString();
      db().run(
        `INSERT INTO outing_requests (id, student_id, outing_type, destination, reason, out_at, expected_return_at, status, location_consent,
           start_latitude, start_longitude, start_accuracy_m, start_location_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId,
        sid,
        o.outingType,
        o.destination ?? '',
        o.reason ?? '',
        outAt,
        returnAt,
        asDraft ? 'Draft' : 'Parent Approval Pending',
        o.locationConsent ? 1 : 0,
        o.latitude ?? null,
        o.longitude ?? null,
        o.accuracyM ?? null,
        o.latitude !== undefined ? now : null,
        now,
        now,
      );
      // The Warden is deliberately NOT notified here: the request is invisible to
      // them until the parent/guardian has approved it.
      recordEvent('outing_request', newId, req.user!.id, asDraft ? 'draft_saved' : 'submitted', { to: asDraft ? 'Draft' : 'Parent Approval Pending' });
      return newId;
    });
    const issued = asDraft ? null : await issueParentApproval(id, req.user!.id);
    audit(req, asDraft ? 'outing.draft_saved' : 'outing.created', 'outing_request', id, issued ? { delivery: issued.delivery.status } : undefined);
    created(
      res,
      { ...mapOuting(getOuting(id)), parentApproval: issued ? { delivery: issued.delivery, link: issued.delivery.status === 'Sent' ? null : issued.link } : null },
      asDraft
        ? 'Outing draft saved.'
        : issued?.delivery.status === 'Sent'
          ? `Outing request ${id} sent to your parent/guardian on WhatsApp for approval.`
          : `Outing request ${id} saved. WhatsApp delivery: ${issued?.delivery.status}. ${issued?.delivery.error ?? ''}`.trim(),
    );
  }),
);

/** Re-sends the parent/guardian approval request for a request still awaiting one. */
router.post(
  '/outing-requests/:id/resend-parent-approval',
  route(async (req, res) => {
    const sid = ownStudentId(req.user!);
    const current = getOuting(req.params.id);
    if (current.student_id !== sid) throw notFound('Outing request');
    if (current.status !== 'Parent Approval Pending') throw conflict(`This request is already "${current.status}".`);
    const issued = await issueParentApproval(current.id, req.user!.id);
    audit(req, 'outing.parent_approval_resent', 'outing_request', current.id, { delivery: issued.delivery.status });
    ok(res, { delivery: issued.delivery, link: issued.delivery.status === 'Sent' ? null : issued.link }, {
      message: issued.delivery.status === 'Sent' ? 'A new approval request was sent on WhatsApp.' : `WhatsApp delivery: ${issued.delivery.status}. ${issued.delivery.error ?? ''}`.trim(),
    });
  }),
);

/** How this installation is set up to reach parents, so the UI never implies more. */
router.get(
  '/whatsapp-status',
  route((_req, res) => ok(res, integrationStatus())),
);

/** Edit a draft, optionally submitting it (status: 'Pending'). */
router.put(
  '/outing-requests/:id',
  route(async (req, res) => {
    const sid = ownStudentId(req.user!);
    const current = getOuting(req.params.id);
    if (current.student_id !== sid) throw notFound('Outing request');
    if (current.status !== 'Draft') throw conflict('Only drafts can be edited.');
    const submit = req.body?.status === 'Pending' || req.body?.status === 'Submit';
    const o = readOuting(req.body, !submit);
    if (submit) {
      validateOutingWindow(o.outAt!, o.returnAt!, sid, current.id);
      guardianFor(sid);
    }
    const outAt = o.outAt ?? current.out_at;
    const returnAt = o.returnAt && o.returnAt > outAt ? o.returnAt : current.expected_return_at > outAt ? current.expected_return_at : new Date(Date.parse(outAt) + 3_600_000).toISOString();
    db().run(
      `UPDATE outing_requests SET outing_type = ?, destination = ?, reason = ?, out_at = ?, expected_return_at = ?, status = ?, updated_at = ? WHERE id = ?`,
      o.outingType,
      o.destination ?? current.destination,
      o.reason ?? current.reason,
      outAt,
      returnAt,
      submit ? 'Parent Approval Pending' : 'Draft',
      nowIso(),
      current.id,
    );
    db().run('UPDATE outing_requests SET location_consent = ? WHERE id = ?', o.locationConsent ? 1 : 0, current.id);
    // A fresh fix replaces the stored one; an absent fix leaves the last known pin alone.
    if (o.latitude !== undefined && o.longitude !== undefined) {
      db().run(
        'UPDATE outing_requests SET start_latitude = ?, start_longitude = ?, start_accuracy_m = ?, start_location_at = ? WHERE id = ?',
        o.latitude,
        o.longitude,
        o.accuracyM ?? null,
        nowIso(),
        current.id,
      );
    }
    let issued = null;
    if (submit) {
      recordEvent('outing_request', current.id, req.user!.id, 'submitted', { from: 'Draft', to: 'Parent Approval Pending' });
      issued = await issueParentApproval(current.id, req.user!.id);
    }
    ok(res, { ...mapOuting(getOuting(current.id)), parentApproval: issued ? { delivery: issued.delivery, link: issued.delivery.status === 'Sent' ? null : issued.link } : null }, {
      message: submit ? `Outing request ${current.id} sent to your parent/guardian for approval.` : 'Draft updated.',
    });
  }),
);

router.delete(
  '/outing-requests/:id',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    const current = getOuting(req.params.id);
    if (current.student_id !== sid) throw notFound('Outing request');
    if (current.status === 'Draft') {
      db().run('DELETE FROM outing_requests WHERE id = ?', current.id);
      return ok(res, null, { message: 'Draft deleted.' });
    }
    if (!['Parent Approval Pending', 'Pending Warden'].includes(current.status)) throw conflict(`A "${current.status}" request cannot be withdrawn.`);
    db().run(`UPDATE outing_requests SET status = 'Cancelled', updated_at = ? WHERE id = ?`, nowIso(), current.id);
    db().run(`UPDATE outing_parent_approvals SET decision = 'Rejected', decided_at = ?, decision_note = 'Withdrawn by the student', updated_at = ? WHERE outing_id = ? AND decision IS NULL`, nowIso(), nowIso(), current.id);
    recordEvent('outing_request', current.id, req.user!.id, 'withdrawn', { from: current.status, to: 'Cancelled' });
    ok(res, null, { message: `Outing request ${current.id} withdrawn.` });
  }),
);

// ---------------------------------------------------------------------------
// Outpasses (read-only for students; gate movements are recorded by Security)
// ---------------------------------------------------------------------------
router.get(
  '/outpasses',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    ok(res, db().all(`SELECT ${OUTPASS_SELECT} WHERE p.student_id = ? AND p.status != 'Cancelled' ORDER BY p.valid_from DESC`, sid).map(mapOutpass));
  }),
);

// ---------------------------------------------------------------------------
// Attendance, study sessions, academics (own records only)
// ---------------------------------------------------------------------------
router.get(
  '/attendance',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    const records = db().all<any>('SELECT att_date, session, status, recorded_at FROM attendance_records WHERE student_id = ? ORDER BY att_date DESC LIMIT 120', sid);
    const cases = db().all<any>('SELECT id, att_date, session, status, verification_note, resolution_note FROM absence_cases WHERE student_id = ? ORDER BY att_date DESC', sid);
    const total = records.length;
    const present = records.filter((r) => r.status === 'Present').length;
    ok(res, {
      records: records.map((r) => ({ date: r.att_date, dateDisplay: fmtDate(r.att_date), session: r.session, status: r.status })),
      absenceRecords: cases.map((c) => ({ id: c.id, date: fmtDate(c.att_date), session: c.session, status: c.status, note: c.resolution_note || c.verification_note || null })),
      summary: { recordedDays: total, present, attendancePct: total ? Math.round((present / total) * 1000) / 10 : null },
    });
  }),
);

router.get(
  '/study-sessions',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    const rows = db().all<any>(
      `SELECT ss.*, sa.status AS my_status, sa.remarks AS my_remarks, adv.name AS adviser_name
       FROM study_sessions ss
       LEFT JOIN study_attendance sa ON sa.session_id = ss.id AND sa.student_id = ?
       LEFT JOIN users adv ON adv.id = ss.adviser_user_id
       JOIN students s ON s.id = ?
       LEFT JOIN rooms r ON r.id = s.room_id
       WHERE (ss.block IS NULL OR ss.block = r.block) AND (ss.department_code IS NULL OR ss.department_code = s.department_code) AND (ss.year IS NULL OR ss.year = s.year)
       ORDER BY ss.session_date DESC, ss.start_time DESC LIMIT 100`,
      sid,
      sid,
    );
    const marked = rows.filter((r) => r.my_status);
    const attended = marked.filter((r) => r.my_status === 'Present' || r.my_status === 'Late').length;
    const denom = marked.filter((r) => r.my_status !== 'Excused').length;
    ok(res, {
      sessions: rows.map((r) => ({
        id: r.id,
        title: r.title,
        date: r.session_date,
        dateDisplay: fmtDate(r.session_date),
        time: `${r.start_time} – ${r.end_time}`,
        location: r.location,
        // The staff member running the session: students are told who to report to.
        staffName: r.adviser_name || 'Not assigned',
        status: r.status,
        myStatus: r.my_status || (r.status === 'Scheduled' ? 'Upcoming' : 'Not Marked'),
        remarks: r.my_remarks || '',
      })),
      summary: { sessionsMarked: marked.length, attended, participationPct: denom ? Math.round((attended / denom) * 1000) / 10 : null },
    });
  }),
);

router.get(
  '/academics',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    ok(
      res,
      db()
        .all<any>('SELECT * FROM academic_records WHERE student_id = ? ORDER BY academic_year DESC, semester DESC, assessment', sid)
        .map((a) => ({ id: a.id, academicYear: a.academic_year, semester: a.semester, assessment: a.assessment, percentage: a.percentage, sgpa: a.sgpa, arrears: a.arrears, remarks: a.remarks })),
    );
  }),
);

// ---------------------------------------------------------------------------
// Mess feedback
// ---------------------------------------------------------------------------
router.post(
  '/mess-feedback',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    const v = new Validator(req.body);
    const meal = v.oneOf('meal', ['Breakfast', 'Lunch', 'Snacks', 'Dinner', 'General Dining'] as const, { label: 'Meal' });
    const food = v.int('foodRating', { min: 1, max: 5, label: 'Food rating' });
    const hygiene = v.int('hygieneRating', { min: 1, max: 5, label: 'Hygiene rating' });
    const speed = v.int('speedRating', { min: 1, max: 5, label: 'Service rating' });
    const comment = v.string('comment', { required: false, max: 1000 });
    v.done();
    const today = localDate();
    const day = new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    const existing = db().get('SELECT 1 FROM mess_feedback WHERE student_id = ? AND menu_date = ? AND meal = ?', sid, today, meal);
    if (existing) throw conflict(`You already rated today's ${meal}.`);
    const id = uid('mfb');
    db().run(
      `INSERT INTO mess_feedback (id, student_id, meal, menu_date, day, food_rating, hygiene_rating, speed_rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      sid,
      meal,
      today,
      day,
      food,
      hygiene,
      speed,
      comment ?? null,
      nowIso(),
    );
    notify(usersWithRole('Mess'), {
      eventType: 'mess.feedback',
      title: `New ${meal} feedback`,
      message: `Rated ${Math.round(((food! + hygiene! + speed!) / 3) * 10) / 10}/5${comment ? `: ${comment.slice(0, 80)}` : ''}`,
      entityType: 'mess_feedback',
      entityId: id,
      link: '/mess/student-feedback',
    });
    created(res, { id }, 'Thank you — your feedback was recorded.');
  }),
);

// ---------------------------------------------------------------------------
// Live study sessions: see the QR, scan it, see your own attendance
// ---------------------------------------------------------------------------
router.get(
  '/study-sessions/live',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    const from = String(req.query.from || addDays(localDate(), -14));
    const to = String(req.query.to || addDays(localDate(), 14));
    ok(res, studentSessions(sid, from, to));
  }),
);

/** The live QR for a session this student is on the roster for. */
router.get(
  '/study-sessions/:id/qr',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    const phase = req.query.phase === 'End' ? 'End' : 'Start';
    ok(res, studentQr(sid, req.params.id, phase));
  }),
);

/** The student's own code, for the Adviser to scan when the student cannot scan. */
router.get(
  '/study-sessions/:id/my-code',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    ok(res, myAttendanceCode(sid, req.params.id));
  }),
);

/**
 * Records an attendance scan. Validity, the roster check and the one-scan-per-phase
 * rule are all enforced here; an expired token can never record attendance, and an
 * end scan never turns a missed start scan into Present.
 */
router.post(
  '/study-sessions/scan',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    const v = new Validator(req.body);
    const token = v.string('token', { max: 200, label: 'QR code' });
    v.done();
    const result = scanSessionQr(req.user!, sid, token!);
    audit(req, `study_session.${result.phase.toLowerCase()}_scan`, 'study_session', result.sessionId);
    ok(res, result, { message: result.message });
  }),
);

// ---------------------------------------------------------------------------
// Outing location sharing
//
// The device reports only what the browser can actually observe: a position fix, a
// denied permission, or a positioning error. Nothing is collected outside an
// approved outing window, and tracking stops when the outing ends.
// ---------------------------------------------------------------------------
router.get(
  '/outing-requests/:id/tracking',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    const current = getOuting(req.params.id);
    if (current.student_id !== sid) throw notFound('Outing request');
    ok(res, {
      tracking: trackingView(current.id, req.user!),
      parentApprovals: parentApprovalHistory(current.id),
      history: locationHistory(current.id, 25),
    });
  }),
);

router.post(
  '/outing-requests/:id/tracking',
  route((req, res) => {
    const sid = ownStudentId(req.user!);
    const current = getOuting(req.params.id);
    if (current.student_id !== sid) throw notFound('Outing request');
    const v = new Validator(req.body);
    const status = v.oneOf('status', TRACKING_STATUSES, { label: 'Tracking status' });
    const latitude = v.number('latitude', { required: false, min: -90, max: 90 });
    const longitude = v.number('longitude', { required: false, min: -180, max: 180 });
    const accuracyM = v.number('accuracyM', { required: false, min: 0, max: 100_000 });
    const reason = v.string('reason', { required: false, max: 300 });
    v.done();
    const tracking = recordTracking(req.user!, current.id, { status: status!, latitude, longitude, accuracyM, reason });
    ok(res, tracking);
  }),
);

export default router;
