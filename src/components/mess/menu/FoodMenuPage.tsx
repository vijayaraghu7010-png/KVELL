import React, { useState } from 'react';
import { DayOfWeek, MealCategory, MenuItem } from '../../../types/mess';
import { messDataService } from '../../../services/messDataService';
import { FoodMenuItemModal } from './FoodMenuItemModal';

interface FoodMenuPageProps {
  onShowToast: (msg: string, isError?: boolean) => void;
}

const DAYS: DayOfWeek[] = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'
];

const MEALS: MealCategory[] = ['Breakfast', 'Lunch', 'Snacks', 'Dinner'];

export const FoodMenuPage: React.FC<FoodMenuPageProps> = ({ onShowToast }) => {
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(() => messDataService.getTodayDay());
  const [saving, setSaving] = useState(false);
  const [selectedMeal, setSelectedMeal] = useState<MealCategory>('Breakfast');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);

  // Confirmation state for deleting
  const [itemToDelete, setItemToDelete] = useState<MenuItem | null>(null);

  // Description edit state
  const dayMenu = messDataService.getMenuForDay(selectedDay);
  const mealKey = selectedMeal.toLowerCase() as 'breakfast' | 'lunch' | 'snacks' | 'dinner';
  const currentSlot = dayMenu[mealKey];

  const [mealDesc, setMealDesc] = useState<string>(currentSlot.desc);

  // Keep description in sync when day/meal changes
  React.useEffect(() => {
    setMealDesc(currentSlot.desc);
  }, [selectedDay, selectedMeal, currentSlot.desc]);

  // Item edits change the unsaved working copy; nothing reaches the server until Save Draft / Publish.
  const handleSaveItem = (itemData: Omit<MenuItem, 'id'>) => {
    if (editingItem) {
      messDataService.editMenuItem(selectedDay, selectedMeal, editingItem.id, itemData);
      onShowToast(`Updated "${itemData.name}" (unsaved — save draft or publish).`);
    } else {
      const added = messDataService.addMenuItem(selectedDay, selectedMeal, itemData);
      onShowToast(`Added "${added.name}" (unsaved — save draft or publish).`);
    }
    setEditingItem(null);
  };

  const handleConfirmDelete = () => {
    if (!itemToDelete) return;
    messDataService.deleteMenuItem(selectedDay, selectedMeal, itemToDelete.id);
    onShowToast(`Removed "${itemToDelete.name}" (unsaved — save draft or publish).`);
    setItemToDelete(null);
  };

  const persist = async (publish: boolean) => {
    if (saving) return;
    setSaving(true);
    try {
      const msg = publish
        ? await messDataService.publishMeal(selectedDay, selectedMeal, currentSlot.items, mealDesc)
        : await messDataService.saveMealDraft(selectedDay, selectedMeal, currentSlot.items, mealDesc);
      onShowToast(msg);
    } catch (err) {
      onShowToast(err instanceof Error ? err.message : 'Could not save the menu.', true);
    } finally {
      setSaving(false);
    }
  };
  const handlePublish = () => persist(true);
  const handleSaveDraft = () => persist(false);

  return (
    <div className="flex flex-col w-full max-w-7xl mx-auto space-y-6 pb-12">
      {/* 1. Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[var(--kv-surface-alt)] p-6 rounded-2xl border border-[var(--kv-border)]">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-[var(--kv-surface-alt)] text-[var(--kv-primary)] flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[24px]">restaurant</span>
          </div>
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--kv-primary)] block">
              MESS MANAGEMENT & PUBLISHING
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 leading-tight">
              Food Menu Editor
            </h1>
            <p className="text-xs text-slate-600 mt-1">
              Current daily meal spreads, update item descriptions, and publish live dining schedules to the Student Portal.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 bg-white/90 px-4 py-2 rounded-xl border border-blue-100 shadow-2xs self-start md:self-auto">
          <span className="material-symbols-outlined text-[var(--kv-heading)] text-[18px]">calendar_today</span>
          <div className="text-left">
            <span className="font-bold text-slate-800 text-xs block leading-tight">Hostel Dining Service</span>
            <span className="text-[10px] text-slate-500 leading-tight">Auto-synced with student dashboard.</span>
          </div>
        </div>
      </div>

      {/* 2. Days Tabs Pill Bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 select-none">
        {DAYS.map((day) => {
          const isSelected = selectedDay === day;
          return (
            <button
              key={day}
              type="button"
              id={`mess-day-${day.toLowerCase()}`}
              onClick={() => setSelectedDay(day)}
              className={`px-6 py-2.5 rounded-full text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
                isSelected
                  ? 'bg-[var(--kv-primary)] text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>

      {/* 3. Main Meal Editor Container */}
      <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-xs space-y-6">
        {/* Meal Category Tabs & Status Pill */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            {MEALS.map((meal) => {
              const isActive = selectedMeal === meal;
              return (
                <button
                  key={meal}
                  type="button"
                  id={`mess-meal-tab-${meal.toLowerCase()}`}
                  onClick={() => setSelectedMeal(meal)}
                  className={`px-5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
                    isActive
                      ? 'bg-[var(--kv-primary)] text-white shadow-xs font-bold'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {meal}
                </button>
              );
            })}
          </div>

          {/* Published status badge */}
          <div className="flex items-center">
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[var(--kv-surface-alt)] text-[var(--kv-primary)] border border-[var(--kv-border)] text-xs font-semibold">
              <span className="text-[14px] font-bold">+</span>
              <span>Published for Students</span>
            </span>
          </div>
        </div>

        {/* Info Strip (Meal Window, Scheduled Day & Date, Last Status Update) */}
        <div className="p-4 rounded-xl border border-slate-200/70 bg-[var(--kv-surface-alt)] space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-[var(--kv-primary)] text-[20px] mt-0.5">
                schedule
              </span>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                  MEAL WINDOW
                </span>
                <span className="font-bold text-slate-800 text-sm">
                  {currentSlot.timing}
                </span>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-[var(--kv-primary)] text-[20px] mt-0.5">
                calendar_today
              </span>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                  SCHEDULED DAY & DATE
                </span>
                <span className="font-bold text-slate-800 text-sm">
                  {selectedDay}, {dayMenu.date}
                </span>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-[var(--kv-primary)] text-[20px] mt-0.5">
                update
              </span>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                  LAST STATUS UPDATE
                </span>
                <span className="font-mono text-slate-700 text-xs font-medium">
                  {messDataService.isDirty(selectedDay, selectedMeal) ? 'Unsaved changes' : currentSlot.publishedAt || currentSlot.lastEditedAt || 'Not saved yet'}
                </span>
              </div>
            </div>
          </div>

          {/* Nutritional & Meal Description Box */}
          <div className="pt-2 border-t border-slate-100">
            <label className="text-xs font-bold text-slate-800 block mb-1.5">
              Nutritional & Meal Description
            </label>
            <input
              type="text"
              value={mealDesc}
              onChange={(e) => setMealDesc(e.target.value)}
              placeholder="e.g. Classic wholesome breakfast favorites."
              className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-[var(--kv-primary)] transition-colors"
            />
          </div>
        </div>

        {/* Food Items Header */}
        <div className="flex items-center justify-between pt-1">
          <div>
            <h3 className="font-bold text-slate-900 text-sm">
              Food Items in {selectedMeal} ({currentSlot.items.length})
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Items that will appear on student menus and dining counters.
            </p>
          </div>

          <button
            type="button"
            id="add-food-item-btn"
            onClick={() => {
              setEditingItem(null);
              setIsModalOpen(true);
            }}
            className="px-4 py-2 bg-[var(--kv-primary)] hover:bg-blue-600 text-white rounded-xl text-xs font-bold transition shadow-xs flex items-center gap-1.5 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            <span>Add Food Item</span>
          </button>
        </div>

        {/* Food Items Table */}
        {currentSlot.items.length === 0 ? (
          <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 space-y-2">
            <span className="material-symbols-outlined text-[32px] text-slate-300">no_meals</span>
            <p className="text-xs font-bold text-slate-700">No Food Items Added</p>
            <p className="text-[11px] text-slate-500">
              Click &quot;Add Food Item&quot; to begin building this meal schedule.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200/70 rounded-xl">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[var(--kv-surface-alt)] border-b border-slate-200/80 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4 font-bold">ITEM NAME</th>
                  <th className="py-3 px-4 font-bold">CATEGORY TAG</th>
                  <th className="py-3 px-4 font-bold">DIETARY</th>
                  <th className="py-3 px-4 font-bold">DESCRIPTION</th>
                  <th className="py-3 px-4 text-right font-bold">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {currentSlot.items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3.5 px-4 font-semibold text-slate-900">
                      {item.name}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="text-[11px] bg-[var(--kv-surface-alt)] text-[var(--kv-primary)] px-3 py-1 rounded-full font-semibold">
                        {item.categoryTag}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                        <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                        <span>Veg</span>
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-500 max-w-sm">
                      {item.description || 'Nutritious morning preparation served hot at the dining counter.'}
                    </td>
                    <td className="py-3.5 px-4 text-right space-x-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingItem(item);
                          setIsModalOpen(true);
                        }}
                        className="text-[var(--kv-primary)] hover:underline font-semibold text-xs transition cursor-pointer"
                        title="Edit item"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setItemToDelete(item)}
                        className="text-slate-400 hover:text-rose-600 hover:underline font-semibold text-xs transition cursor-pointer"
                        title="Delete item"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Bottom Actions Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-100">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="material-symbols-outlined text-[var(--kv-primary)] text-[18px]">
              info
            </span>
            <span>
              Publishing makes this menu immediately visible on the Student Portal for {selectedDay}.
            </span>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              type="button"
              id="mess-save-draft-btn"
              onClick={handleSaveDraft}
              className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-xs transition cursor-pointer shadow-2xs"
            >
              Save as Draft
            </button>
            <button
              type="button"
              id="mess-publish-btn"
              onClick={handlePublish}
              className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl bg-[var(--kv-primary)] hover:bg-blue-600 text-white font-bold text-xs transition shadow-sm cursor-pointer flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[16px]">send</span>
              <span>Publish Menu for Students</span>
            </button>
          </div>
        </div>
      </div>

      {/* Add / Edit Item Modal */}
      <FoodMenuItemModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingItem(null);
        }}
        onSave={handleSaveItem}
        initialItem={editingItem}
        category={selectedMeal}
      />

      {/* Delete Item Confirmation Modal */}
      {itemToDelete && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setItemToDelete(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-sm w-full border border-slate-200 shadow-2xl p-6 text-slate-800 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 text-rose-600 font-bold text-sm">
              <span className="material-symbols-outlined text-[22px]">delete_forever</span>
              <span>Confirm Item Removal</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Are you sure you want to remove <strong className="text-slate-900">&quot;{itemToDelete.name}&quot;</strong> from the {selectedMeal} menu?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setItemToDelete(null)}
                className="px-3 py-1.5 rounded-xl text-slate-600 hover:bg-slate-100 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-xs cursor-pointer"
              >
                Yes, Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
