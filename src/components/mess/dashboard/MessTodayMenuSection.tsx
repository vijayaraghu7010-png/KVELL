import React from 'react';
import { DayMenu } from '../../../types/mess';

interface MessTodayMenuSectionProps {
  todayMenu: DayMenu;
  onManageMenu: () => void;
}

export const MessTodayMenuSection: React.FC<MessTodayMenuSectionProps> = ({
  todayMenu,
  onManageMenu,
}) => {
  const mealCards = [
    {
      category: 'BREAKFAST',
      timing: '07:30 AM - 09:30 AM',
      icon: 'wb_sunny',
      status: todayMenu.breakfast.isPublished ? 'Published' : 'Draft',
      itemsText: todayMenu.breakfast.items.map((i) => i.name).join(', ') || 'Upma & Coconut Chutney, Boiled Egg / Fruit, Filter Coffee / Tea',
      tags: [
        todayMenu.breakfast.items[0]?.name || 'Upma & Coconut Chutney',
        todayMenu.breakfast.items[1]?.name || 'Boiled Egg / Fruit',
      ],
      extraCount: Math.max(1, todayMenu.breakfast.items.length - 2),
    },
    {
      category: 'LUNCH',
      timing: '12:30 PM - 01:30 PM',
      icon: 'lunch_dining',
      status: todayMenu.lunch.isPublished ? 'Published' : 'Draft',
      itemsText: todayMenu.lunch.items.map((i) => i.name).join(', ') || 'Tomato Rice & Raita, Chana Masala, Pullikka & Salad',
      tags: [
        todayMenu.lunch.items[0]?.name || 'Tomato Rice & Raita',
        todayMenu.lunch.items[1]?.name || 'Chana Masala',
      ],
      extraCount: Math.max(2, todayMenu.lunch.items.length - 2),
    },
    {
      category: 'DINNER',
      timing: '06:30 PM - 07:30 PM',
      icon: 'dinner_dining',
      status: todayMenu.dinner.isPublished ? 'Published' : 'Draft',
      itemsText: todayMenu.dinner.items.map((i) => i.name).join(', ') || 'Chapati & Dal Tadka, Peas Pulao, Ice Cream',
      tags: [
        todayMenu.dinner.items[0]?.name || 'Chapati & Dal Tadka',
        todayMenu.dinner.items[1]?.name || 'Peas Pulao',
      ],
      extraCount: Math.max(1, todayMenu.dinner.items.length - 2),
    },
  ];

  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-xs">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[var(--kv-surface-alt)] text-[var(--kv-primary)] flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[20px]">restaurant</span>
          </div>
          <div>
            <h3 className="font-bold text-sm text-slate-900 leading-tight">
              Today's Menu
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Published menu schedule for {todayMenu.date} ({todayMenu.day})
            </p>
          </div>
        </div>

        <button
          onClick={onManageMenu}
          type="button"
          id="manage-menu-btn"
          className="text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs"
        >
          <span>Manage Menu</span>
          <span className="material-symbols-outlined text-[15px] text-slate-500">edit</span>
        </button>
      </div>

      {/* 3 Meal Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        {mealCards.map((meal) => (
          <div
            key={meal.category}
            className="p-4 rounded-xl border border-blue-100/60 bg-[var(--kv-surface-alt)] flex flex-col justify-between"
          >
            <div>
              {/* Card Top: Icon, Category, Timing, Badge */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-[var(--kv-surface-alt)] text-[var(--kv-primary)] flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[17px]">{meal.icon}</span>
                  </div>
                  <div>
                    <h4 className="text-[11px] font-bold text-slate-900 uppercase tracking-wider">
                      {meal.category}
                    </h4>
                    <span className="text-[10px] text-slate-400 font-mono block">
                      {meal.timing}
                    </span>
                  </div>
                </div>

                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200">
                  {meal.status}
                </span>
              </div>

              {/* Meal Description / Item List */}
              <p className="text-xs font-medium text-slate-700 leading-relaxed my-2">
                {meal.itemsText}
              </p>
            </div>

            {/* Chips at bottom */}
            <div className="flex flex-wrap items-center gap-1.5 pt-2 mt-2 border-t border-slate-100">
              {meal.tags.map((tag, idx) => (
                <span
                  key={idx}
                  className="px-2 py-0.5 rounded-md bg-[var(--kv-surface-alt)] text-[var(--kv-heading)] text-[10px] font-medium truncate max-w-[150px]"
                >
                  {tag}
                </span>
              ))}
              {meal.extraCount > 0 && (
                <span className="px-2 py-0.5 rounded-md bg-[var(--kv-surface-alt)] text-[var(--kv-heading)] text-[10px] font-bold">
                  +{meal.extraCount}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
