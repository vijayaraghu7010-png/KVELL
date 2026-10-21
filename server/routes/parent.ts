import { Router } from 'express';
import { ok, route } from '../lib/http';
import { audit } from '../lib/records';
import { Validator } from '../lib/validate';
import { parentApprovalView, parentDecide } from '../services/outings';

/**
 * Parent/guardian approval, reached from the WhatsApp message.
 *
 * These routes are mounted before the session guard because a guardian has no
 * account here. Authorisation is the unguessable, single-use, expiring token that
 * was sent only to the number stored on the student's profile; it is held in the
 * database as a SHA-256 hash and is bound to exactly one outing request.
 */
const router = Router();

router.get(
  '/outings/:token',
  route((req, res) => {
    ok(res, parentApprovalView(req.params.token));
  }),
);

router.post(
  '/outings/:token/decision',
  route((req, res) => {
    const v = new Validator(req.body);
    const decision = v.oneOf('decision', ['Approved', 'Rejected'] as const, { label: 'Decision' });
    const note = v.string('note', { required: false, max: 500, label: 'Message' });
    v.done();
    const result = parentDecide(req.params.token, decision!, note, req.ip ?? null);
    audit(null, `outing.parent_${decision!.toLowerCase()}`, 'outing_request', result.outingId, { source: 'parent-link', ip: req.ip });
    ok(res, { ...result, view: parentApprovalView(req.params.token) }, {
      message: decision === 'Approved' ? 'Thank you. The hostel Warden will now review the request.' : 'Thank you. The request has been declined and the student has been told.',
    });
  }),
);

export default router;
