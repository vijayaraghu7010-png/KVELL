/**
 * KVCET Hostel ERP — Mess Portal Types
 */

export type MessTab = 'home' | 'dashboard' | 'food-menu' | 'student-feedback';

export type MealCategory = 'Breakfast' | 'Lunch' | 'Snacks' | 'Dinner';

export type DayOfWeek = 
  | 'Monday' 
  | 'Tuesday' 
  | 'Wednesday' 
  | 'Thursday' 
  | 'Friday' 
  | 'Saturday' 
  | 'Sunday';

export interface MenuItem {
  id: string;
  name: string;
  categoryTag: string; // e.g. 'Main', 'Sides', 'Beverage', 'Dessert', 'Starter', 'Gravy'
  description?: string;
  image?: string;
  isVegetarian?: boolean;
}

export interface MealSlot {
  category: MealCategory;
  timing: string;
  desc: string;
  items: MenuItem[];
  isPublished: boolean;
  publishedAt?: string;
  lastEditedAt?: string;
}

export interface DayMenu {
  day: DayOfWeek;
  date: string;
  breakfast: MealSlot;
  lunch: MealSlot;
  snacks: MealSlot;
  dinner: MealSlot;
}

export interface StudentFeedbackItem {
  id: string;
  studentName: string;
  regNumber: string;
  roomNumber?: string;
  mealCategory: MealCategory | 'General Dining';
  menuDate: string;
  day: DayOfWeek;
  foodRating: number;      // 1 to 5
  hygieneRating: number;   // 1 to 5
  speedRating: number;     // 1 to 5
  averageRating: number;   // Computed average
  comment: string;
  submittedAt: string;
}

export interface MessProfile {
  id: string;
  name: string;
  staffId: string;
  role: string;
  designation: string;
  email: string;
  phone: string;
  diningHall: string;
  shiftTimings: string;
  isDemo: boolean;
}
