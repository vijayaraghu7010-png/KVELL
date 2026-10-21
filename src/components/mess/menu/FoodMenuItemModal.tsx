import React, { useState, useEffect } from 'react';
import { MenuItem, MealCategory } from '../../../types/mess';

interface FoodMenuItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (item: Omit<MenuItem, 'id'>) => void;
  initialItem?: MenuItem | null;
  category: MealCategory;
}

const COMMON_TAGS = ['Main', 'Sides', 'Beverage', 'Dessert', 'Starter', 'Gravy', 'Rice', 'Accompaniment', 'Snack', 'Dip'];

export const FoodMenuItemModal: React.FC<FoodMenuItemModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialItem,
  category,
}) => {
  const [name, setName] = useState('');
  const [categoryTag, setCategoryTag] = useState('Main');
  const [description, setDescription] = useState('');
  const [isVegetarian, setIsVegetarian] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialItem) {
      setName(initialItem.name);
      setCategoryTag(initialItem.categoryTag);
      setDescription(initialItem.description || '');
      setIsVegetarian(initialItem.isVegetarian !== false);
    } else {
      setName('');
      setCategoryTag(category === 'Breakfast' ? 'Main' : category === 'Dinner' ? 'Main' : 'Grains');
      setDescription('');
      setIsVegetarian(true);
    }
    setError(null);
  }, [initialItem, isOpen, category]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Food item name is required.');
      return;
    }
    onSave({
      name: name.trim(),
      categoryTag: categoryTag.trim() || 'Main',
      description: description.trim() || undefined,
      isVegetarian,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden p-6 text-slate-800 space-y-4 animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="food-item-modal-title"
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[var(--kv-heading)] text-[22px]">restaurant_menu</span>
            <h3 id="food-item-modal-title" className="font-bold text-slate-900 text-base">
              {initialItem ? 'Edit Food Item' : `Add Food Item (${category})`}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 font-bold"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {error && (
            <div className="p-2.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl font-semibold">
              {error}
            </div>
          )}

          <div>
            <label className="font-bold text-slate-700 block mb-1">
              Food Item Name *
            </label>
            <input
              type="text"
              id="food-item-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Masala Dosa, Paneer Butter Masala, Sambar"
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-[var(--kv-primary)] focus:bg-white transition"
              autoFocus
            />
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1">
              Category Tag / Course
            </label>
            <div className="flex items-center gap-2">
              <select
                id="food-item-category-tag-select"
                value={categoryTag}
                onChange={(e) => setCategoryTag(e.target.value)}
                className="flex-1 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-[var(--kv-primary)] cursor-pointer"
              >
                {COMMON_TAGS.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="font-bold text-slate-700 block mb-1">
              Description & Dietary Notes (Optional)
            </label>
            <textarea
              id="food-item-desc-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Served crisp with 2 chutneys and steaming lentil sambar."
              rows={2}
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-[var(--kv-primary)] focus:bg-white transition"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="food-item-veg-toggle"
              checked={isVegetarian}
              onChange={(e) => setIsVegetarian(e.target.checked)}
              className="w-4 h-4 text-[var(--kv-heading)] rounded border-slate-300 focus:ring-[var(--kv-primary)]"
            />
            <label htmlFor="food-item-veg-toggle" className="font-semibold text-slate-700 cursor-pointer">
              Vegetarian Preparation (Green Veg Logo)
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              id="food-item-save-btn"
              className="px-5 py-2 rounded-xl text-white font-bold transition shadow-xs cursor-pointer bg-[var(--kv-primary)] hover:bg-blue-600"
            >
              {initialItem ? 'Update Item' : 'Add Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
