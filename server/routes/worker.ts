import { Router } from 'express';
import { ok, route } from '../lib/http';
import { audit } from '../lib/records';
import { Validator } from '../lib/validate';
import { WORKER_REPORT_OUTCOMES, workerJobView, workerReportJob } from '../services/complaints';

/**
 * The worker's job page, reached from the WhatsApp message.
 *
 * Mounted before the session guard: a hostel worker has no account here. The
 * authorisation is the unguessable, expiring token that was sent only to the
 * number on the worker's record, held as a SHA-256 hash and bound to exactly one
 * assignment. It shows that job alone and accepts one report against it.
 */
const router = Router();

router.get(
  '/jobs/:token',
  route((req, res) => {
    ok(res, workerJobView(req.params.token));
  }),
);

router.post(
  '/jobs/:token/report',
  route((req, res) => {
    const v = new Validator(req.body);
    const outcome = v.oneOf('outcome', WORKER_REPORT_OUTCOMES, { label: 'Outcome' });
    // A worker who could not finish must say why; "done" may stand on its own.
    const note = v.string('note', { required: outcome === 'Could Not Complete', min: 3, max: 1000, label: 'Note' });
    v.done();
    const result = workerReportJob(req.params.token, outcome!, note);
    audit(null, outcome === 'Reported Done' ? 'complaint.worker_reported_done' : 'complaint.worker_reported_blocked', 'complaint', result.complaintId, {
      source: 'worker-link',
      ip: req.ip,
    });
    ok(res, { ...result, view: workerJobView(req.params.token) }, {
      message:
        outcome === 'Reported Done'
          ? 'Thank you. The hostel Warden has been told and will verify the work.'
          : 'Thank you. The hostel Warden has been told that the job could not be completed.',
    });
  }),
);

export default router;
