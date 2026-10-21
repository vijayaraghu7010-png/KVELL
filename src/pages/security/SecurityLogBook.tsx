import React, { useState, useMemo } from 'react';
import { SecurityMovementRecord } from '../../types/security';
import { 
  CalendarDays, 
  Search, 
  Filter, 
  MapPin, 
  Bed, 
  Clock, 
  ChevronLeft, 
  ChevronRight, 
  X, 
  RotateCcw 
} from 'lucide-react';

interface SecurityLogBookProps {
  records: SecurityMovementRecord[];
  onShowToast: (message: string, isError?: boolean) => void;
}

export const SecurityLogBook: React.FC<SecurityLogBookProps> = ({
  records,
  onShowToast,
}) => {
  // Search state
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Filter form state (draft inputs)
  const [selectedDestination, setSelectedDestination] = useState<string>('All');
  const [selectedRoom, setSelectedRoom] = useState<string>('All');
  const [selectedInTime, setSelectedInTime] = useState<string>('All');
  const [selectedOutTime, setSelectedOutTime] = useState<string>('All');

  // Applied filter state (activated when "Apply Filters" is clicked)
  const [appliedFilters, setAppliedFilters] = useState<{
    destination: string;
    room: string;
    inTime: string;
    outTime: string;
  }>({
    destination: 'All',
    room: 'All',
    inTime: 'All',
    outTime: 'All',
  });

  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 10;

  // Extract unique filter dropdown options from available records
  const destinationOptions = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => {
      if (r.destination && r.destination !== '—') set.add(r.destination);
    });
    return ['All', ...Array.from(set).sort()];
  }, [records]);

  const roomOptions = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => {
      if (r.roomNo && r.roomNo !== '—') set.add(r.roomNo);
    });
    return ['All', ...Array.from(set).sort()];
  }, [records]);

  // Helper to parse time strings like "08:12 AM" into hour for time range filtering
  const getTimeSlot = (timeStr: string): string => {
    if (!timeStr || timeStr === '—') return 'None';
    const parts = timeStr.trim().split(' ');
    if (parts.length < 2) return 'None';
    const [time, meridiem] = parts;
    const [hourStr] = time.split(':');
    let hour = parseInt(hourStr, 10);
    if (meridiem === 'PM' && hour !== 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;

    if (hour >= 6 && hour < 12) return 'Morning (06:00 AM - 12:00 PM)';
    if (hour >= 12 && hour < 17) return 'Afternoon (12:00 PM - 05:00 PM)';
    return 'Evening (05:00 PM - 10:00 PM)';
  };

  // Filtered dataset
  const filteredRecords = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return records.filter((rec) => {
      // 1. Text Search across name, destination, roomNo, regNumber, gate, type
      if (q) {
        const matchesSearch = 
          rec.name.toLowerCase().includes(q) ||
          rec.destination.toLowerCase().includes(q) ||
          rec.roomNo.toLowerCase().includes(q) ||
          rec.gate.toLowerCase().includes(q) ||
          rec.type.toLowerCase().includes(q) ||
          (rec.regNumber && rec.regNumber.toLowerCase().includes(q));
        if (!matchesSearch) return false;
      }

      // 2. Destination filter
      if (appliedFilters.destination !== 'All' && rec.destination !== appliedFilters.destination) {
        return false;
      }

      // 3. Room filter
      if (appliedFilters.room !== 'All' && rec.roomNo !== appliedFilters.room) {
        return false;
      }

      // 4. In Time filter
      if (appliedFilters.inTime !== 'All') {
        if (appliedFilters.inTime === 'Has In Time' && rec.inTime === '—') return false;
        if (appliedFilters.inTime === 'No In Time' && rec.inTime !== '—') return false;
        if (appliedFilters.inTime.includes('Morning') && getTimeSlot(rec.inTime) !== 'Morning (06:00 AM - 12:00 PM)') return false;
        if (appliedFilters.inTime.includes('Afternoon') && getTimeSlot(rec.inTime) !== 'Afternoon (12:00 PM - 05:00 PM)') return false;
        if (appliedFilters.inTime.includes('Evening') && getTimeSlot(rec.inTime) !== 'Evening (05:00 PM - 10:00 PM)') return false;
      }

      // 5. Out Time filter
      if (appliedFilters.outTime !== 'All') {
        if (appliedFilters.outTime === 'Has Out Time' && rec.outTime === '—') return false;
        if (appliedFilters.outTime === 'No Out Time' && rec.outTime !== '—') return false;
        if (appliedFilters.outTime.includes('Morning') && getTimeSlot(rec.outTime) !== 'Morning (06:00 AM - 12:00 PM)') return false;
        if (appliedFilters.outTime.includes('Afternoon') && getTimeSlot(rec.outTime) !== 'Afternoon (12:00 PM - 05:00 PM)') return false;
        if (appliedFilters.outTime.includes('Evening') && getTimeSlot(rec.outTime) !== 'Evening (05:00 PM - 10:00 PM)') return false;
      }

      return true;
    });
  }, [records, searchQuery, appliedFilters]);

  // Total pages
  const totalRecords = filteredRecords.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));

  // Current page records
  const paginatedRecords = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredRecords.slice(startIndex, startIndex + pageSize);
  }, [filteredRecords, currentPage, pageSize]);

  // Handle Apply Filters
  const handleApplyFilters = () => {
    setAppliedFilters({
      destination: selectedDestination,
      room: selectedRoom,
      inTime: selectedInTime,
      outTime: selectedOutTime,
    });
    setCurrentPage(1);
    onShowToast('Applied gate movement filters.');
  };

  // Handle Reset Filters
  const handleResetFilters = () => {
    setSelectedDestination('All');
    setSelectedRoom('All');
    setSelectedInTime('All');
    setSelectedOutTime('All');
    setAppliedFilters({
      destination: 'All',
      room: 'All',
      inTime: 'All',
      outTime: 'All',
    });
    setSearchQuery('');
    setCurrentPage(1);
    onShowToast('Filters reset to default.');
  };

  const isAnyFilterActive = 
    appliedFilters.destination !== 'All' || 
    appliedFilters.room !== 'All' || 
    appliedFilters.inTime !== 'All' || 
    appliedFilters.outTime !== 'All' ||
    searchQuery.trim() !== '';

  const startRecordNum = totalRecords === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endRecordNum = Math.min(currentPage * pageSize, totalRecords);

  return (
    <div className="space-y-6">
      {/* Page Heading matching Screenshot 2 */}
      <div className="flex items-center gap-3.5">
        <div className="w-12 h-12 rounded-2xl bg-[var(--kv-surface-alt)] text-[var(--kv-primary)] flex items-center justify-center shrink-0 shadow-xs">
          <CalendarDays className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-[var(--kv-heading)] leading-tight">
            Gate Records & Movements
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            View and manage all entry and exit records from the campus.
          </p>
        </div>
      </div>

      {/* Main Grid: Left Table/Search (approx 75%) and Right Filters (approx 25%) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Search & Table Panel (8 or 9 cols on desktop) */}
        <div className="lg:col-span-8 xl:col-span-9 bg-white rounded-2xl shadow-xs border border-blue-50 overflow-hidden">
          {/* Top Search Input matching Screenshot 2 */}
          <div className="p-4 sm:p-5 border-b border-slate-100">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search by name, room number, destination..."
                className="w-full pl-10 pr-9 py-2.5 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-800 placeholder-slate-400 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition shadow-2xs"
                aria-label="Search movement records"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setCurrentPage(1);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                  aria-label="Clear search input"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[700px]">
              <thead>
                <tr className="bg-[var(--kv-surface-alt)] text-slate-700 text-xs font-bold tracking-wider border-b border-blue-100">
                  <th className="py-3.5 px-4 w-12 text-center">S.No</th>
                  <th className="py-3.5 px-4 font-bold">Name</th>
                  <th className="py-3.5 px-4 font-bold">Destination</th>
                  <th className="py-3.5 px-4 font-bold">Room No</th>
                  <th className="py-3.5 px-4 font-bold">In Time</th>
                  <th className="py-3.5 px-4 font-bold">Out Time</th>
                  <th className="py-3.5 px-4 font-bold">In Date</th>
                  <th className="py-3.5 px-4 font-bold">Out Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs sm:text-[13px] text-slate-800">
                {paginatedRecords.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400 text-xs">
                      No gate movement records match the current search or filters.
                    </td>
                  </tr>
                ) : (
                  paginatedRecords.map((row, idx) => (
                    <tr 
                      key={row.id} 
                      className="hover:bg-blue-50/25 transition-colors"
                    >
                      <td className="py-3.5 px-4 text-center font-bold text-slate-700">
                        {(currentPage - 1) * pageSize + idx + 1}
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-[var(--kv-heading)]">
                        {row.name}
                      </td>
                      <td className="py-3.5 px-4 font-medium text-slate-700">
                        {row.destination}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-medium text-slate-600">
                        {row.roomNo}
                      </td>
                      <td className="py-3.5 px-4 font-medium text-slate-600">
                        {row.inTime}
                      </td>
                      <td className="py-3.5 px-4 font-medium text-slate-600">
                        {row.outTime}
                      </td>
                      <td className="py-3.5 px-4 font-medium text-slate-600">
                        {row.inDate}
                      </td>
                      <td className="py-3.5 px-4 font-medium text-slate-600">
                        {row.outDate}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer with Pagination Controls matching Screenshot 2 */}
          <div className="px-5 py-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
            <div>
              Showing <span className="font-semibold text-slate-700">{startRecordNum}</span>–<span className="font-semibold text-slate-700">{endRecordNum}</span> of <span className="font-semibold text-slate-700">{totalRecords}</span> records
            </div>

            {/* Pagination Controls */}
            <nav aria-label="Pagination Navigation" className="flex items-center gap-1.5 select-none">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {/* Page numbers up to 5 */}
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => i + 1).map((pageNum) => {
                const isActive = currentPage === pageNum;
                return (
                  <button
                    key={pageNum}
                    type="button"
                    onClick={() => setCurrentPage(pageNum)}
                    className={`w-8 h-8 rounded-lg text-xs font-bold transition cursor-pointer ${
                      isActive
                        ? 'bg-[var(--kv-nav-bg)] text-white shadow-xs'
                        : 'border border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    {pageNum}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages || totalRecords === 0}
                className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </nav>
          </div>
        </div>

        {/* Right Column: Filters Panel matching Screenshot 2 (approx 25%) */}
        <div className="lg:col-span-4 xl:col-span-3 bg-white rounded-2xl shadow-xs border border-blue-50 p-5 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-[var(--kv-heading)]" />
              <h2 className="text-base font-bold text-[var(--kv-heading)]">Filters</h2>
            </div>
            {isAnyFilterActive && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="text-[11px] font-semibold text-blue-600 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            )}
          </div>

          <div className="space-y-4">
            {/* 1. Destination Field */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">
                Destination
              </label>
              <div className="relative">
                <MapPin className="w-4 h-4 text-blue-600 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  value={selectedDestination}
                  onChange={(e) => setSelectedDestination(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-100 cursor-pointer shadow-2xs appearance-none"
                  aria-label="Filter by destination"
                >
                  {destinationOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-xs">
                  ▼
                </div>
              </div>
            </div>

            {/* 2. Room Number Field */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">
                Room Number
              </label>
              <div className="relative">
                <Bed className="w-4 h-4 text-blue-600 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  value={selectedRoom}
                  onChange={(e) => setSelectedRoom(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-100 cursor-pointer shadow-2xs appearance-none"
                  aria-label="Filter by room number"
                >
                  {roomOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-xs">
                  ▼
                </div>
              </div>
            </div>

            {/* 3. In Time Field */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">
                In Time
              </label>
              <div className="relative">
                <Clock className="w-4 h-4 text-blue-600 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  value={selectedInTime}
                  onChange={(e) => setSelectedInTime(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-100 cursor-pointer shadow-2xs appearance-none"
                  aria-label="Filter by in time"
                >
                  <option value="All">All</option>
                  <option value="Morning (06:00 AM - 12:00 PM)">Morning (06:00 AM - 12:00 PM)</option>
                  <option value="Afternoon (12:00 PM - 05:00 PM)">Afternoon (12:00 PM - 05:00 PM)</option>
                  <option value="Evening (05:00 PM - 10:00 PM)">Evening (05:00 PM - 10:00 PM)</option>
                  <option value="Has In Time">Has Recorded In-Time</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-xs">
                  ▼
                </div>
              </div>
            </div>

            {/* 4. Out Time Field */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">
                Out Time
              </label>
              <div className="relative">
                <Clock className="w-4 h-4 text-blue-600 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  value={selectedOutTime}
                  onChange={(e) => setSelectedOutTime(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-100 cursor-pointer shadow-2xs appearance-none"
                  aria-label="Filter by out time"
                >
                  <option value="All">All</option>
                  <option value="Morning (06:00 AM - 12:00 PM)">Morning (06:00 AM - 12:00 PM)</option>
                  <option value="Afternoon (12:00 PM - 05:00 PM)">Afternoon (12:00 PM - 05:00 PM)</option>
                  <option value="Evening (05:00 PM - 10:00 PM)">Evening (05:00 PM - 10:00 PM)</option>
                  <option value="Has Out Time">Has Recorded Out-Time</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-xs">
                  ▼
                </div>
              </div>
            </div>

            {/* Apply Filters Button */}
            <button
              type="button"
              onClick={handleApplyFilters}
              className="w-full py-2.5 px-4 bg-[var(--kv-nav-bg)] hover:bg-[var(--kv-primary-hover)] text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer mt-2"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Apply Filters</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
