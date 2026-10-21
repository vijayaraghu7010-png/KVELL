import { Router } from 'express';
import { db } from '../db/database';
import { requireRole } from '../lib/auth';
import { badRequest, ok, route } from '../lib/http';
import { audit, notify, usersWithRole } from '../lib/records';
import { addDays, fmtDate, fmtDateTime, localDate, nowIso, parseJson, uid } from '../lib/util';
import { Validator } from '../lib/validate';

const router = Router();

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export const MEALS = ['Breakfast', 'Lunch', 'Snacks', 'Dinner'] as const;
const DEFAULT_TIMING: Record<string, string> = {
  Breakfast: '07:30 AM - 09:30 AM',
  Lunch: '12:30 PM - 02:00 PM',
  Snacks: '04:30 PM - 05:30 PM',
  Dinner: '07:30 PM - 09:00 PM',
};

interface MenuItem {
  id: string;
  name: string;
  categoryTag: string;
  description?: string;
  isVegetarian?: boolean;
}

/** Date of the next occurrence (today or later) of a weekday, in the institution timezone. */
function dateForDay(day: string) {
  const today = localDate();
  const idx = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
  const target = (DAYS.indexOf(day as (typeof DAYS)[number]) + 1) % 7;
  return addDays(today, (target - idx(today) + 7) % 7);
}

export const todayDayName = () => new Date(`${localDate()}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

/** Builds the existing `DayMenu` UI shape. Students only ever see published content. */
function buildWeek(publishedOnly: boolean) {
  const rows = db().all<any>('SELECT * FROM mess_menu');
  const by = new Map(rows.map((r) => [`${r.day}:${r.meal}`, r]));
  return DAYS.map((day) => {
    const slot = (meal: string) => {
      const r = by.get(`${day}:${meal}`);
      const items = r ? parseJson<MenuItem[]>(publishedOnly ? r.published_items_json : r.items_json, []) : [];
      return {
        category: meal,
        timing: r?.timing || DEFAULT_TIMING[meal],
        desc: (publishedOnly ? r?.published_description : r?.description) || '',
        items,
        isPublished: !!r && r.is_published === 1,
        hasPublishedVersion: !!r?.published_items_json,
        publishedAt: r?.published_at ? fmtDateTime(r.published_at) : undefined,
        lastEditedAt: r?.updated_at ? fmtDateTime(r.updated_at) : undefined,
      };
    };
    return {
      day,
      date: fmtDate(dateForDay(day)),
      breakfast: slot('Breakfast'),
      lunch: slot('Lunch'),
      snacks: slot('Snacks'),
      dinner: slot('Dinner'),
    };
  });
}

router.get(
  '/menu',
  route((req, res) => {
    const staff = ['Mess', 'Warden', 'Admin'].includes(req.user!.role);
    ok(res, { today: todayDayName(), todayDate: fmtDate(localDate()), week: buildWeek(!staff || req.query.view === 'published') });
  }),
);

router.put(
  '/menu/:day/:meal',
  requireRole('Mess'),
  route((req, res) => {
    const day = DAYS.find((d) => d === req.params.day);
    const meal = MEALS.find((m) => m === req.params.meal);
    if (!day || !meal) throw badRequest('Unknown day or meal.');
    const v = new Validator(req.body);
    const description = v.string('description', { required: false, max: 300 }) ?? '';
    const timing = v.string('timing', { required: false, max: 60 }) ?? DEFAULT_TIMING[meal];
    const publish = v.bool('publish');
    v.done();
    const rawItems = Array.isArray(req.body.items) ? req.body.items : null;
    if (!rawItems) throw badRequest('Items must be a list.');
    if (rawItems.length > 40) throw badRequest('A meal can have at most 40 items.');
    const items: MenuItem[] = rawItems.map((it: any) => {
      if (!it || typeof it.name !== 'string' || !it.name.trim() || it.name.length > 120) throw badRequest('Every item needs a name (max 120 characters).');
      return {
        id: typeof it.id === 'string' && it.id.length < 80 ? it.id : uid('item'),
        name: it.name.trim(),
        categoryTag: typeof it.categoryTag === 'string' ? it.categoryTag.slice(0, 40) : 'Main',
        description: typeof it.description === 'string' ? it.description.slice(0, 300) : undefined,
        isVegetarian: it.isVegetarian !== false,
      };
    });
    if (publish && items.length === 0) throw badRequest('Add at least one item before publishing.');
    const now = nowIso();
    const json = JSON.stringify(items);
    db().run(
      `INSERT INTO mess_menu (day, meal, timing, description, items_json, published_items_json, published_description, is_published, published_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(day, meal) DO UPDATE SET timing = excluded.timing, description = excluded.description, items_json = excluded.items_json,
         published_items_json = CASE WHEN ? THEN excluded.items_json ELSE mess_menu.published_items_json END,
         published_description = CASE WHEN ? THEN excluded.description ELSE mess_menu.published_description END,
         is_published = excluded.is_published,
         published_at = CASE WHEN ? THEN excluded.updated_at ELSE mess_menu.published_at END,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      day,
      meal,
      timing,
      description,
      json,
      publish ? json : null,
      publish ? description : null,
      publish ? 1 : 0,
      publish ? now : null,
      req.user!.id,
      now,
      publish ? 1 : 0,
      publish ? 1 : 0,
      publish ? 1 : 0,
    );
    audit(req, publish ? 'mess.menu_published' : 'mess.menu_draft_saved', 'mess_menu', `${day}:${meal}`, { items: items.length });
    if (publish && day === todayDayName()) {
      notify(usersWithRole('Student'), {
        eventType: 'mess.menu_published',
        title: `Today's ${meal} menu updated`,
        message: items.map((i) => i.name).slice(0, 5).join(', '),
        entityType: 'mess_menu',
        entityId: `${day}:${meal}`,
        link: '/student/mess-menu',
        dedupeKey: `mess.menu:${localDate()}:${meal}:${now.slice(0, 15)}`,
      });
    }
    ok(res, buildWeek(false).find((d) => d.day === day), { message: publish ? `${day} ${meal} published to students.` : `${day} ${meal} saved as draft (not visible to students).` });
  }),
);

router.get(
  '/feedback',
  requireRole('Mess', 'Warden'),
  route((_req, res) => {
    ok(
      res,
      db()
        .all<any>(
          `SELECT f.*, s.name AS student_name, s.reg_number, r.room_number FROM mess_feedback f JOIN students s ON s.id = f.student_id LEFT JOIN rooms r ON r.id = s.room_id ORDER BY f.created_at DESC LIMIT 500`,
        )
        .map((f) => ({
          id: f.id,
          studentName: f.student_name,
          regNumber: f.reg_number,
          roomNumber: f.room_number || undefined,
          mealCategory: f.meal,
          menuDate: fmtDate(f.menu_date),
          day: f.day,
          foodRating: f.food_rating,
          hygieneRating: f.hygiene_rating,
          speedRating: f.speed_rating,
          averageRating: Math.round(((f.food_rating + f.hygiene_rating + f.speed_rating) / 3) * 10) / 10,
          comment: f.comment || '',
          submittedAt: fmtDateTime(f.created_at),
        })),
    );
  }),
);

router.get(
  '/metrics',
  requireRole('Mess', 'Warden'),
  route((_req, res) => {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const fb = db().all<any>('SELECT food_rating, hygiene_rating, speed_rating FROM mess_feedback WHERE created_at >= ?', since);
    const avgs = fb.map((f) => (f.food_rating + f.hygiene_rating + f.speed_rating) / 3);
    const positive = avgs.filter((a) => a >= 4).length;
    const today = todayDayName();
    const todayRows = db().all<any>('SELECT * FROM mess_menu WHERE day = ?', today);
    ok(res, {
      totalStudents: db().get<any>(`SELECT COUNT(*) AS c FROM students WHERE enrollment_status = 'Active' AND is_hosteller = 1`).c,
      mealsServedToday: null, // Not tracked: no meal-count source exists in the system.
      totalFeedback: fb.length,
      averageRating: avgs.length ? Math.round((avgs.reduce((a, b) => a + b, 0) / avgs.length) * 10) / 10 : null,
      positiveFeedback: positive,
      neutralNegativeFeedback: fb.length - positive,
      positivePercentage: fb.length ? Math.round((positive / fb.length) * 100) : null,
      needsAttentionPercentage: fb.length ? 100 - Math.round((positive / fb.length) * 100) : null,
      publishedMealsCount: todayRows.filter((r) => r.published_items_json).length,
      totalMenuItemsToday: todayRows.reduce((s, r) => s + parseJson<MenuItem[]>(r.items_json, []).length, 0),
      feedbackToday: db().get<any>('SELECT COUNT(*) AS c FROM mess_feedback WHERE menu_date = ?', localDate()).c,
      windowDays: 30,
    });
  }),
);

export default router;
