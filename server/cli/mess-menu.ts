/**
 * The hostel's published weekly mess menu.
 *
 *   npm run mess:menu     — (re)publishes it onto an existing database
 *
 * `npm run db:seed-demo` calls publishWeeklyMenu() for a fresh database; this
 * entry point exists because the seeder refuses to touch a database it has
 * already seeded, so an installed system needs its own way to refresh the menu.
 */
import 'dotenv/config';
import { db } from '../db/database';
import { nowIso } from '../lib/util';

export const WEEKLY_MENU: Record<string, Record<string, string[][]>> = {
  Monday: {
    Breakfast: [['Idli & Sambar', 'Main'], ['Coconut Chutney', 'Sides'], ['Filter Coffee / Tea', 'Beverage']],
    Lunch: [['Steamed Rice', 'Main'], ['Sambar', 'Gravy'], ['Beans Poriyal', 'Sides'], ['Curd', 'Sides'], ['Appalam', 'Sides']],
    Snacks: [['Sundal', 'Snack'], ['Tea', 'Beverage']],
    Dinner: [['Chapati', 'Main'], ['Veg Kurma', 'Gravy'], ['Banana', 'Dessert']],
  },
  Tuesday: {
    Breakfast: [['Pongal', 'Main'], ['Vada', 'Sides'], ['Coconut Chutney', 'Sides'], ['Filter Coffee / Tea', 'Beverage']],
    Lunch: [['Steamed Rice', 'Main'], ['Vatha Kuzhambu', 'Gravy'], ['Cabbage Poriyal', 'Sides'], ['Rasam', 'Gravy'], ['Curd', 'Sides']],
    Snacks: [['Bajji', 'Snack'], ['Tea', 'Beverage']],
    Dinner: [['Idiyappam', 'Main'], ['Coconut Milk', 'Gravy'], ['Sugar', 'Sides']],
  },
  Wednesday: {
    Breakfast: [['Poori', 'Main'], ['Potato Masala', 'Gravy'], ['Filter Coffee / Tea', 'Beverage']],
    Lunch: [['Steamed Rice', 'Main'], ['Kara Kuzhambu', 'Gravy'], ['Carrot Poriyal', 'Sides'], ['Rasam', 'Gravy'], ['Curd', 'Sides']],
    Snacks: [['Groundnut Sundal', 'Snack'], ['Tea', 'Beverage']],
    Dinner: [['Chapati', 'Main'], ['Channa Masala', 'Gravy'], ['Kesari', 'Dessert']],
  },
  Thursday: {
    Breakfast: [['Dosa', 'Main'], ['Tomato Chutney', 'Sides'], ['Sambar', 'Gravy'], ['Filter Coffee / Tea', 'Beverage']],
    Lunch: [['Lemon Rice', 'Main'], ['Steamed Rice', 'Main'], ['Mor Kuzhambu', 'Gravy'], ['Beetroot Poriyal', 'Sides'], ['Curd', 'Sides']],
    Snacks: [['Bonda', 'Snack'], ['Tea', 'Beverage']],
    Dinner: [['Parotta', 'Main'], ['Veg Salna', 'Gravy'], ['Banana', 'Dessert']],
  },
  Friday: {
    Breakfast: [['Upma', 'Main'], ['Coconut Chutney', 'Sides'], ['Filter Coffee / Tea', 'Beverage']],
    Lunch: [['Veg Biryani', 'Main'], ['Onion Raita', 'Sides'], ['Brinjal Gravy', 'Gravy'], ['Appalam', 'Sides']],
    Snacks: [['Masala Vadai', 'Snack'], ['Tea', 'Beverage']],
    Dinner: [['Chapati', 'Main'], ['Dal Tadka', 'Gravy'], ['Payasam', 'Dessert']],
  },
  Saturday: {
    Breakfast: [['Rava Kichadi', 'Main'], ['Coconut Chutney', 'Sides'], ['Filter Coffee / Tea', 'Beverage']],
    Lunch: [['Steamed Rice', 'Main'], ['Sambar', 'Gravy'], ['Avial', 'Sides'], ['Rasam', 'Gravy'], ['Curd', 'Sides']],
    Snacks: [['Bread Toast', 'Snack'], ['Tea', 'Beverage']],
    Dinner: [['Idli', 'Main'], ['Milagai Podi', 'Sides'], ['Sambar', 'Gravy']],
  },
  Sunday: {
    Breakfast: [['Ven Pongal', 'Main'], ['Medhu Vada', 'Sides'], ['Sambar', 'Gravy'], ['Filter Coffee / Tea', 'Beverage']],
    Lunch: [['Steamed Rice', 'Main'], ['Paruppu Kuzhambu', 'Gravy'], ['Potato Fry', 'Sides'], ['Rasam', 'Gravy'], ['Curd', 'Sides'], ['Semiya Payasam', 'Dessert']],
    Snacks: [['Mixture', 'Snack'], ['Tea', 'Beverage']],
    Dinner: [['Chapati', 'Main'], ['Mixed Veg Gravy', 'Gravy'], ['Fruit Bowl', 'Dessert']],
  },
};
export const MEAL_TIMING: Record<string, string> = {
  Breakfast: '07:30 AM - 09:30 AM',
  Lunch: '12:30 PM - 02:00 PM',
  Snacks: '04:30 PM - 05:30 PM',
  Dinner: '07:30 PM - 09:00 PM',
};

/** Writes every day/meal of the rotation and publishes it to students. */
export function publishWeeklyMenu(at = nowIso()): number {
  const d = db();
  let written = 0;
  for (const [day, meals] of Object.entries(WEEKLY_MENU)) {
    for (const [meal, items] of Object.entries(meals)) {
      const json = JSON.stringify(items.map(([n, tag], i) => ({ id: `menu-${day}-${meal}-${i}`, name: n, categoryTag: tag, isVegetarian: true })));
      const desc = `${day} ${meal.toLowerCase()} — served at the hostel dining hall.`;
      d.run(
        `INSERT INTO mess_menu (day, meal, timing, description, items_json, published_items_json, published_description, is_published, published_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(day, meal) DO UPDATE SET timing = excluded.timing, description = excluded.description, items_json = excluded.items_json,
           published_items_json = excluded.published_items_json, published_description = excluded.published_description,
           is_published = 1, published_at = excluded.published_at, updated_at = excluded.updated_at`,
        day,
        meal,
        MEAL_TIMING[meal],
        desc,
        json,
        json,
        desc,
        at,
        at,
      );
      written++;
    }
  }
  return written;
}

// Run directly: node --import tsx server/cli/mess-menu.ts
if (process.argv[1] && process.argv[1].includes('mess-menu')) {
  const n = publishWeeklyMenu();
  console.log(`Published ${n} menu entries (7 days x 4 meals).`);
}
