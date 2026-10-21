export type SecurityTab = 'home' | 'qr-scanner' | 'log-book';

export type GateMovementType = 'Entry' | 'Exit';

export interface SecurityMovementRecord {
  id: string;
  sNo: number;
  name: string;
  regNumber: string;
  destination: string;
  roomNo: string;
  inTime: string;   // e.g. "08:12 AM" or "—"
  outTime: string;  // e.g. "09:58 AM" or "—"
  inDate: string;   // e.g. "10 Oct 2025" or "—"
  outDate: string;  // e.g. "10 Oct 2025" or "—"
  gate: string;     // e.g. "Main Gate", "North Gate", "Hostel Gate"
  type: GateMovementType;
}

export interface SecurityScanRecord {
  id: string;
  sNo: number;
  name: string;
  regNumber: string;
  type: GateMovementType;
  time: string;
  gate: string;
  destination?: string;
  roomNo?: string;
  date: string;
  status: 'Approved' | 'Flagged' | 'Duplicate';
  notes?: string;
}

export interface SecurityMetrics {
  todayEntries: number;
  entriesTrend: string;
  entriesComparison: string;
  todayExits: number;
  exitsTrend: string;
  exitsComparison: string;
  currentlyInside: number;
  insideCaption: string;
  needsAttention: number;
  attentionCaption: string;
}

export interface SecurityFilterOptions {
  destination: string;
  roomNumber: string;
  inTime: string;
  outTime: string;
  searchQuery: string;
}

export interface SecurityNotification {
  id: string;
  title: string;
  message: string;
  time: string;
  type: 'info' | 'warning' | 'alert';
  read: boolean;
}
