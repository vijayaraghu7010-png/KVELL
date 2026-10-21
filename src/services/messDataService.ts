/**
 * KVCET Hostel ERP — Mess Data Service (Mess in-charge portal).
 *
 * API-backed store with the same synchronous read interface the mess screens use.
 * Item add/edit/delete change an unsaved working copy; "Save draft" and "Publish"
 * persist it to the server (students only ever see the published copy).
 */
import { DayMenu, DayOfWeek, MealCategory, MenuItem, MealSlot, StudentFeedbackItem, MessProfile } from '../types/mess';
import { errorMessage, http } from './http';

const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const slotKey = (c: MealCategory) => c.toLowerCase() as 'breakfast' | 'lunch' | 'snacks' | 'dinner';

export interface MessMetrics {
  totalStudents: number;
  mealsServedToday: number | null;
  totalFeedback: number;
  averageRating: number | null;
  positiveFeedback: number;
  neutralNegativeFeedback: number;
  positivePercentage: number | null;
  needsAttentionPercentage: number | null;
  publishedMealsCount: number;
  totalMenuItemsToday: number;
  feedbackToday: number;
  windowDays: number;
}

const EMPTY_SLOT = (category: MealCategory): MealSlot => ({ category, timing: '', desc: '', items: [], isPublished: false });
const emptyDay = (day: DayOfWeek): DayMenu => ({ day, date: '', breakfast: EMPTY_SLOT('Breakfast'), lunch: EMPTY_SLOT('Lunch'), snacks: EMPTY_SLOT('Snacks'), dinner: EMPTY_SLOT('Dinner') });

class MessDataService {
  private menus: Record<DayOfWeek, DayMenu> = Object.fromEntries(DAYS.map((d) => [d, emptyDay(d)])) as Record<DayOfWeek, DayMenu>;
  private dirty = new Set<string>();
  private feedbacks: StudentFeedbackItem[] = [];
  private metrics: MessMetrics | null = null;
  private profile: MessProfile | null = null;
  private today: DayOfWeek = 'Monday';
  private todayDate = '';
  private listeners = new Set<() => void>();
  public loading = true;
  public error: string | null = null;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  /** Loads menu, feedback and metrics from the server. */
  async load() {
    this.loading = true;
    this.notify();
    try {
      const [menu, feedbacks, metrics] = await Promise.all([
        http.get<{ today: DayOfWeek; todayDate: string; week: DayMenu[] }>('/mess/menu'),
        http.get<StudentFeedbackItem[]>('/mess/feedback'),
        http.get<MessMetrics>('/mess/metrics'),
      ]);
      menu.week.forEach((d) => {
        // Keep unsaved edits for slots the user is still working on.
        const current = this.menus[d.day];
        this.menus[d.day] = {
          ...d,
          breakfast: this.dirty.has(`${d.day}:Breakfast`) ? current.breakfast : d.breakfast,
          lunch: this.dirty.has(`${d.day}:Lunch`) ? current.lunch : d.lunch,
          snacks: this.dirty.has(`${d.day}:Snacks`) ? current.snacks : d.snacks,
          dinner: this.dirty.has(`${d.day}:Dinner`) ? current.dinner : d.dinner,
        };
      });
      this.today = menu.today;
      this.todayDate = menu.todayDate;
      this.feedbacks = feedbacks;
      this.metrics = metrics;
      this.error = null;
    } catch (err) {
      this.error = errorMessage(err);
    } finally {
      this.loading = false;
      this.notify();
    }
  }

  setProfile(p: MessProfile) {
    this.profile = p;
  }
  getProfile(): MessProfile {
    return this.profile ?? { id: '', name: '', staffId: '', role: 'Mess In-charge', designation: '', email: '', phone: '', diningHall: '', shiftTimings: '', isDemo: false };
  }

  getTodayDay(): DayOfWeek {
    return this.today;
  }
  getTodayDate(): string {
    return this.todayDate;
  }
  getAllMenus(): Record<DayOfWeek, DayMenu> {
    return this.menus;
  }
  getMenuForDay(day: DayOfWeek): DayMenu {
    return this.menus[day];
  }
  getTodayMenu(): DayMenu {
    return this.menus[this.today];
  }
  isDirty(day: DayOfWeek, category: MealCategory) {
    return this.dirty.has(`${day}:${category}`);
  }

  private mutateSlot(day: DayOfWeek, category: MealCategory, fn: (slot: MealSlot) => MealSlot) {
    const key = slotKey(category);
    this.menus[day] = { ...this.menus[day], [key]: fn(this.menus[day][key]) };
    this.dirty.add(`${day}:${category}`);
    this.notify();
  }

  addMenuItem(day: DayOfWeek, category: MealCategory, item: Omit<MenuItem, 'id'>): MenuItem {
    const newItem: MenuItem = { ...item, id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
    this.mutateSlot(day, category, (s) => ({ ...s, items: [...s.items, newItem], isPublished: false }));
    return newItem;
  }

  editMenuItem(day: DayOfWeek, category: MealCategory, itemId: string, updates: Partial<MenuItem>) {
    this.mutateSlot(day, category, (s) => ({ ...s, items: s.items.map((i) => (i.id === itemId ? { ...i, ...updates } : i)), isPublished: false }));
  }

  deleteMenuItem(day: DayOfWeek, category: MealCategory, itemId: string) {
    this.mutateSlot(day, category, (s) => ({ ...s, items: s.items.filter((i) => i.id !== itemId), isPublished: false }));
  }

  private async save(day: DayOfWeek, category: MealCategory, items: MenuItem[], desc: string | undefined, publish: boolean): Promise<string> {
    const slot = this.menus[day][slotKey(category)];
    const res = await http.put<DayMenu>(`/mess/menu/${day}/${category}`, { items, description: desc ?? slot.desc, timing: slot.timing || undefined, publish });
    this.dirty.delete(`${day}:${category}`);
    this.menus[day] = res.data;
    // Metrics (published count, items today) depend on the menu.
    http
      .get<MessMetrics>('/mess/metrics')
      .then((m) => {
        this.metrics = m;
        this.notify();
      })
      .catch(() => undefined);
    this.notify();
    return res.message ?? 'Saved.';
  }

  publishMeal(day: DayOfWeek, category: MealCategory, items: MenuItem[], desc?: string) {
    return this.save(day, category, items, desc, true);
  }

  saveMealDraft(day: DayOfWeek, category: MealCategory, items: MenuItem[], desc?: string) {
    return this.save(day, category, items, desc, false);
  }

  getFeedbacks(): StudentFeedbackItem[] {
    return this.feedbacks;
  }

  getMetrics(): MessMetrics {
    return (
      this.metrics ?? {
        totalStudents: 0,
        mealsServedToday: null,
        totalFeedback: 0,
        averageRating: null,
        positiveFeedback: 0,
        neutralNegativeFeedback: 0,
        positivePercentage: null,
        needsAttentionPercentage: null,
        publishedMealsCount: 0,
        totalMenuItemsToday: 0,
        feedbackToday: 0,
        windowDays: 30,
      }
    );
  }
}

export const messDataService = new MessDataService();
