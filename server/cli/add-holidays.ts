/**
 * Loads holidays from Academic Calendar 2026-27
 *
 *   npm run cli add-holidays
 *
 * - Adds the Tamil Nadu government festival holidays and the academic calendar exam dates
 * - Sundays are NOT stored here; the portal calendars colour them as holidays themselves
 */
import 'dotenv/config';
import { db } from '../db/database';
import { uid, nowIso } from '../lib/util';

const holidays = [
  // --- 2026 : Tamil Nadu government holiday list (G.O. Ms. No. 708) ---
  { date: '2026-01-01', name: 'New Year Day', category: 'Festival', description: 'New Year' },
  { date: '2026-01-15', name: 'Pongal', category: 'Festival', description: 'Thai Pongal harvest festival' },
  { date: '2026-01-16', name: 'Thiruvalluvar Day', category: 'Festival', description: 'Second day of Pongal' },
  { date: '2026-01-17', name: 'Uzhavar Thirunal', category: 'Festival', description: 'Farmers day, third day of Pongal' },
  { date: '2026-01-26', name: 'Republic Day', category: 'Other', description: 'National holiday' },
  { date: '2026-02-01', name: 'Thai Poosam', category: 'Festival', description: 'Thaipusam' },
  { date: '2026-03-19', name: 'Telugu New Year', category: 'Festival', description: 'Ugadi' },
  { date: '2026-03-21', name: 'Ramzan (Idul Fitr)', category: 'Festival', description: 'Date subject to moon sighting' },
  { date: '2026-03-31', name: 'Mahaveer Jayanthi', category: 'Festival', description: 'Jain festival' },
  { date: '2026-04-03', name: 'Good Friday', category: 'Festival', description: 'Christian holy day' },
  { date: '2026-04-14', name: 'Tamil New Year / Ambedkar Jayanthi', category: 'Festival', description: 'Puthandu and Dr. B.R. Ambedkar birth anniversary' },
  { date: '2026-05-01', name: 'May Day', category: 'Other', description: 'International Labour Day' },
  { date: '2026-05-28', name: 'Bakrid', category: 'Festival', description: 'Idul Azha, date subject to moon sighting' },
  { date: '2026-06-26', name: 'Muharram', category: 'Festival', description: 'Date subject to moon sighting' },
  { date: '2026-08-15', name: 'Independence Day', category: 'Other', description: 'National holiday' },
  { date: '2026-08-26', name: 'Milad-un-Nabi', category: 'Festival', description: 'Date subject to moon sighting' },
  { date: '2026-09-04', name: 'Krishna Jayanthi', category: 'Festival', description: 'Janmashtami' },
  { date: '2026-09-14', name: 'Vinayakar Chathurthi', category: 'Festival', description: 'Ganesh Chaturthi' },
  { date: '2026-10-02', name: 'Gandhi Jayanthi', category: 'Other', description: 'National holiday' },
  { date: '2026-10-19', name: 'Ayutha Pooja', category: 'Festival', description: 'Saraswathi Pooja' },
  { date: '2026-10-20', name: 'Vijaya Dasami', category: 'Festival', description: 'Dasara festival' },
  { date: '2026-11-08', name: 'Deepavali', category: 'Festival', description: 'Festival of lights' },
  { date: '2026-12-25', name: 'Christmas', category: 'Festival', description: 'Christmas Day' },

  // --- 2027 : rest of the 2026-27 academic year. Provisional — the Tamil Nadu
  // G.O. for 2027 is not published yet, so confirm these before the year starts.
  { date: '2027-01-01', name: 'New Year Day', category: 'Festival', description: 'New Year' },
  { date: '2027-01-15', name: 'Pongal', category: 'Festival', description: 'Thai Pongal harvest festival (provisional)' },
  { date: '2027-01-16', name: 'Thiruvalluvar Day', category: 'Festival', description: 'Second day of Pongal (provisional)' },
  { date: '2027-01-17', name: 'Uzhavar Thirunal', category: 'Festival', description: 'Farmers day, third day of Pongal (provisional)' },
  { date: '2027-01-23', name: 'Thai Poosam', category: 'Festival', description: 'Thaipusam (provisional)' },
  { date: '2027-01-26', name: 'Republic Day', category: 'Other', description: 'National holiday' },
  { date: '2027-03-11', name: 'Ramzan (Idul Fitr)', category: 'Festival', description: 'Provisional — subject to moon sighting' },
  { date: '2027-03-26', name: 'Good Friday', category: 'Festival', description: 'Christian holy day' },
  { date: '2027-04-07', name: 'Telugu New Year', category: 'Festival', description: 'Ugadi (provisional)' },
  { date: '2027-04-14', name: 'Tamil New Year / Ambedkar Jayanthi', category: 'Festival', description: 'Puthandu and Dr. B.R. Ambedkar birth anniversary' },
  { date: '2027-04-19', name: 'Mahaveer Jayanthi', category: 'Festival', description: 'Jain festival (provisional)' },
  { date: '2027-05-01', name: 'May Day', category: 'Other', description: 'International Labour Day' },
  { date: '2027-05-17', name: 'Bakrid', category: 'Festival', description: 'Idul Azha — provisional, subject to moon sighting' },
  { date: '2027-06-16', name: 'Muharram', category: 'Festival', description: 'Provisional — subject to moon sighting' },
  { date: '2027-08-15', name: 'Independence Day', category: 'Other', description: 'National holiday' },
  { date: '2027-08-16', name: 'Milad-un-Nabi', category: 'Festival', description: 'Provisional — subject to moon sighting; falls next to Independence Day in 2027' },
  { date: '2027-08-25', name: 'Krishna Jayanthi', category: 'Festival', description: 'Janmashtami (provisional)' },
  { date: '2027-09-04', name: 'Vinayakar Chathurthi', category: 'Festival', description: 'Ganesh Chaturthi (provisional)' },
  { date: '2027-10-02', name: 'Gandhi Jayanthi', category: 'Other', description: 'National holiday' },
  { date: '2027-10-09', name: 'Ayutha Pooja', category: 'Festival', description: 'Saraswathi Pooja (provisional)' },
  { date: '2027-10-10', name: 'Vijaya Dasami', category: 'Festival', description: 'Dasara festival (provisional)' },
  { date: '2027-10-29', name: 'Deepavali', category: 'Festival', description: 'Festival of lights (provisional)' },
  { date: '2027-12-25', name: 'Christmas', category: 'Festival', description: 'Christmas Day' },

  // --- Academic calendar 2026-27 examination dates ---
  { date: '2026-11-05', name: 'End of Semester Examination', category: 'Exam', description: 'University End Semester Examination begins' },
];

/**
 * Loads any holiday not already stored. A date already in the table is left alone:
 * the institution may have corrected a provisional date, and that correction wins.
 * Returns how many rows were added.
 */
export function loadHolidays(log = false): number {
  const d = db();
  let added = 0;
  d.transaction(() => {
    for (const h of holidays) {
      if (d.get<any>('SELECT id FROM holidays WHERE holiday_date = ?', h.date)) {
        if (log) console.log(`Holiday on ${h.date} already exists, skipping.`);
        continue;
      }
      d.run(
        `INSERT INTO holidays (id, holiday_date, name, category, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        uid('hol'),
        h.date,
        h.name,
        h.category,
        h.description,
        nowIso(),
        nowIso(),
      );
      added++;
      if (log) console.log(`Added holiday: ${h.name} on ${h.date}`);
    }
  });
  return added;
}

// Run directly: npm run add:holidays
if (process.argv[1] && process.argv[1].includes('add-holidays')) {
  const added = loadHolidays(true);
  console.log(`Holidays added: ${added} (of ${holidays.length} in the list).`);
  console.log('Note: Sundays are coloured as holidays by the portal calendars, not stored here.');
}
