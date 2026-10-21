export type PortalRole = 'warden' | 'student' | 'security' | 'hod' | 'adviser' | 'mess' | 'ao' | 'dean' | 'admin';
export * from './types/security';
export * from './types/hod';
export * from './types/adviser';
export * from './types/mess';
export * from './types/ao';

/** Roles known to the server (see server/lib/auth.ts). */
export type UserRole = 
  | 'Student'
  | 'Warden'
  | 'Adviser'
  | 'HOD'
  | 'Principal'
  | 'Security'
  | 'AO'
  | 'Mess'
  | 'Admin'
  | 'Dean';

export const USER_ROLES: UserRole[] = [
  'Student',
  'Warden',
  'Adviser',
  'HOD',
  'Dean',
  'AO',
  'Security',
  'Mess',
  'Principal',
  'Admin'
];

export type DashboardTab = 
  | 'home'
  | 'notifications'
  | 'raise-complaint'
  | 'leave-request'
  | 'leave-request-status'
  | 'outing-permission'
  | 'my-outpass'
  | 'complaint-status'
  | 'mess-menu'
  | 'profile';

export type WardenTab = 
  | 'home'
  | 'student-info'
  | 'leave-requests'
  | 'outing-requests'
  | 'log-book'
  | 'student-complaints'
  | 'maintenance-complaints'
  | 'attendance'
  | 'room-allocation'
  | 'reports';

export interface StudentRecord {
  id: string;
  name: string;
  regNumber: string;
  department: string;
  year: string;
  roomNumber: string;
  status: 'Present' | 'On Leave' | 'On Outing';
  gender: string;
  contactNumber: string;
  permanentAddress: string;
  parentName: string;
  parentNumber: string;
  enrollmentStatus: string;
}

export interface WardenLeaveRecord {
  id: string;
  name: string;
  regNumber: string;
  department: string;
  year: string;
  reason: string;
  fromDate: string;
  toDate: string;
  dateRange: string;
  roomNumber: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  submittedDateTime: string;
  hasDocument?: boolean;
  documentName?: string;
  parentName?: string;
  parentNumber?: string;
  parentCallLog?: string[];
  rejectionReason?: string;
}

export interface WardenLogRecord {
  id: string;
  dateTime: string;
  studentName: string;
  regNumber: string;
  roomNumber: string;
  department: string;
  year?: string;
  destination: string;
  leaveType: string;
  category: 'Leave' | 'Outing';
  file?: string;
  approvalStatus: 'Approved' | 'Pending' | 'Rejected';
  approvedBy: string;
  approvedOn: string;
  outTime: string;
  expectedReturn: string;
  parentApproval: string;
  leaveDuration?: string;
}

export interface WardenAttendanceRecord {
  id: string;
  name: string;
  regNumber: string;
  roomNumber: string;
  department: string;
  year: string;
  status: 'Present' | 'Absent' | 'On Leave' | 'On Outing';
  checkInTime: string;
  method: 'Biometric' | 'Manual Roll Call' | 'RFID Card' | 'Gate Pass';
  date: string;
  session: string;
  studentPhone: string;
  parentName: string;
  parentPhone: string;
  remarks?: string;
  weeklyHistory?: { day: string; status: 'P' | 'A' | 'L' | 'O' }[];
  semesterAttendanceRate?: number;
  totalDays?: number;
  presentDays?: number;
  absentDays?: number;
  historyRecords?: {
    date: string;
    session: string;
    status: 'Present' | 'Absent' | 'On Leave' | 'On Outing';
    time?: string;
  }[];
}

export interface WardenComplaintRecord {
  id: string;
  ticketId: string;
  name: string;
  regNumber: string;
  roomNumber: string;
  department: string;
  year: string;
  complaintType: string; // e.g. Electrical, Plumbing, Carpentry, Cleaning, Wi-Fi, Masonry
  issueDescription: string;
  location: string;
  status: 'Pending' | 'In Progress' | 'Resolved';
  submittedDateTime: string;
  priority: 'High' | 'Medium' | 'Low';
  assignedTechnician?: string;
  technicianContact?: string;
  remarks?: string;
  completedDateTime?: string;
}

export interface RoomOccupant {
  id: string;
  name: string;
  regNumber: string;
  department?: string;
  year?: string;
  phone?: string;
}

export interface WardenRoomRecord {
  id: string;
  roomNumber: string;
  block: string;
  floor: number;
  capacity: number;
  occupied: number;
  roomType: 'Single' | 'Shared' | 'Single / Shared' | 'Double' | 'Triple' | 'Four Sharing';
  status: 'Available' | 'Partially Filled' | 'Full';
  occupants: RoomOccupant[];
  amenities?: string[];
}

export type ComplaintStatus = 'Submitted' | 'Accepted' | 'Worker Assigned' | 'In Progress' | 'Resolved' | 'Closed' | 'Reopened';
export type ComplaintPriority = 'Low' | 'Medium' | 'High' | 'Critical';

/** A complaint category with its configured resolution target per priority. */
export interface ComplaintCategory {
  id: string;
  name: string;
  description: string | null;
  defaultPriority: ComplaintPriority;
  resolutionHours: number;
  workerCategory: string | null;
  routesToAO: boolean;
  isActive: boolean;
  targets: Partial<Record<ComplaintPriority, number>>;
}

export interface ComplaintEscalation {
  id: string;
  reason: 'Complaint About Warden' | 'Deadline Exceeded';
  status: 'Open' | 'Under Review' | 'Action Recorded' | 'Closed';
  previousStatus: string | null;
  notes: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAtDisplay: string;
}

export interface ComplaintAssignment {
  id: string;
  workerName: string;
  workerTrade: string;
  status: 'Assigned' | 'Contacted' | 'Completed' | 'Cancelled';
  assignedBy: string;
  assignedAt: string;
  contactedAt: string | null;
  contactNote: string | null;
  reportStatus?: 'Reported Done' | 'Could Not Complete' | null;
  reportNote?: string | null;
  reportedAt?: string | null;
  /** Set when the system routed the job itself rather than the Warden naming a worker. */
  autoAssigned?: boolean;
  detectedTrade?: string | null;
  detectionSource?: 'category' | 'keywords' | 'fallback' | 'manual' | 'none' | null;
  dispatchChannel?: string | null;
  dispatchStatus?: 'Sent' | 'Failed' | 'Not Configured' | null;
  dispatchError?: string | null;
  dispatchedAt?: string | null;
}

/** What the worker holding the job reported back from their own job link. */
export interface WorkerReport {
  status: 'Reported Done' | 'Could Not Complete';
  note: string | null;
  reportedAt: string;
  workerName: string;
  workerTrade: string;
}

/** What accepting a complaint decided: the trade, the worker and the job delivery. */
export interface AutoRouting {
  detectedTrade: string | null;
  detectionSource: 'category' | 'keywords' | 'fallback' | 'manual' | 'none';
  matchedKeywords: string[];
  reason: string;
  worker: { id: string; name: string; role: string; phone: string; category: string; liveJobs?: number } | null;
  dispatch: { channel: string; status: 'Sent' | 'Failed' | 'Not Configured' | string; error: string | null; link: string | null } | null;
  summary: string;
}

export interface Complaint {
  id: string;
  title?: string;
  categoryId?: string;
  category: string;
  urgency: string;
  description: string;
  location?: string;
  submittedDate: string;
  submittedDateTime?: string;
  authorityRef: string;
  status: ComplaintStatus;
  stages: {
    title: string;
    date: string;
    status: 'completed' | 'current' | 'pending';
    badge?: string;
    desc?: string;
  }[];
  // Resolution target and deadline tracking
  priority?: ComplaintPriority;
  resolutionHours?: number;
  resolutionTarget?: string;
  deadlineAt?: string;
  deadlineDisplay?: string;
  remainingMinutes?: number | null;
  timeRemainingLabel?: string;
  isOverdue?: boolean;
  // Handling
  workflowStatus?: string;
  acceptedBy?: string;
  acceptedAt?: string;
  workerId?: string;
  workerName?: string;
  workerTrade?: string;
  workerRole?: string;
  workerPhone?: string;
  workerAssignedAt?: string;
  contactConfirmedAt?: string;
  assignments?: ComplaintAssignment[];
  workerReport?: WorkerReport | null;
  resolutionNotes?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  closedAt?: string;
  reopenedCount?: number;
  // AO escalation
  isAboutWarden?: boolean;
  escalations?: ComplaintEscalation[];
  escalationReasons?: string[];
  isEscalated?: boolean;
  escalationStatus?: string;
  escalatedAt?: string;
  // Identity and legacy maintenance fields
  studentName?: string;
  regNumber?: string;
  roomNumber?: string;
  block?: string;
  department?: string;
  year?: string;
  fileName?: string;
  assignedTechnician?: string;
  technicianContact?: string;
  workOrderId?: string;
  workOrderStatus?: string;
  history?: HistoryEntry[];
}

export interface HistoryEntry {
  id: number;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  createdAt: string;
  actorName: string | null;
  actorRole: string | null;
}

export interface ComplaintDraft {
  id: string;
  title: string;
  /** The stored value is a complaint_categories id; `categoryId` is the clearer alias. */
  category: string;
  categoryId?: string;
  urgency: string;
  priority?: string;
  location?: string;
  description: string;
  fileName?: string;
  lastEdited: string;
}

export interface LeaveRequest {
  id: string;
  type: string;
  fromDate: string;
  toDate: string;
  fromDateDisplay: string;
  toDateDisplay: string;
  reason: string;
  fileName?: string;
  status: 'Approved' | 'Pending' | 'Rejected' | 'In Review' | 'Cancelled';
  submittedDate: string;
  currentStageIndex: number;
  // Server-provided workflow detail
  workflowStatus?: LeaveWorkflowStatus;
  /** Which approver the request is waiting on right now, and who they are. */
  pendingStage?: 'Class Incharge' | 'HOD' | 'Warden' | null;
  pendingWith?: string | null;
  approvals?: LeaveApproval[];
  rejectedStage?: 'Class Incharge' | 'HOD' | 'Warden';
  section?: string | null;
  department?: string;
  departureAt?: string;
  returnAt?: string;
  departureDisplay?: string;
  returnDisplay?: string;
  classInchargeName?: string;
  classInchargeDecision?: 'Approved' | 'Rejected';
  classInchargeRemarks?: string;
  classInchargeDecidedAt?: string;
  hodName?: string;
  hodDecision?: 'Approved' | 'Rejected';
  hodRemarks?: string;
  hodDecidedAt?: string;
  adviserName?: string;
  adviserDecision?: string;
  adviserRemarks?: string;
  adviserDecidedAt?: string;
  wardenName?: string;
  wardenDecision?: 'Approved' | 'Rejected';
  wardenRemarks?: string;
  wardenDecidedAt?: string;
  rejectionReason?: string;
  parentApproved?: boolean;
  canDecide?: boolean;
  studentName?: string;
  regNumber?: string;
  roomNumber?: string;
  history?: HistoryEntry[];
}

export type LeaveWorkflowStatus = 'Pending Class Incharge' | 'Pending HOD' | 'Pending Warden' | 'Approved' | 'Rejected' | 'Cancelled';

/** One row of the recorded approval chain, in order. */
export interface LeaveApproval {
  stage: 'Class Incharge' | 'HOD' | 'Warden';
  by: string | null;
  decision: 'Approved' | 'Rejected' | null;
  at: string | null;
  atDisplay?: string;
  remarks: string | null;
}

export interface LeaveDraft {
  id: string;
  title: string;
  type?: string;
  fromDate: string;
  toDate: string;
  fromDateDisplay: string;
  toDateDisplay: string;
  reason: string;
  fileName?: string;
  lastEdited: string;
}

export type OutingStatus = 'Draft' | 'Parent Approval Pending' | 'Parent Rejected' | 'Pending Warden' | 'Approved' | 'Rejected' | 'Cancelled';
export type TrackingStatus = 'Not Started' | 'Permission Granted' | 'Active' | 'Unavailable' | 'Denied' | 'Revoked' | 'Stopped';

export interface OutingRequest {
  id: string;
  dateTime: string;
  expectedReturn: string;
  destination: string;
  reason: string;
  status: OutingStatus;
  dateDisplay: string;
  outAt?: string;
  expectedReturnAt?: string;
  outingType?: string;
  remarks?: string;
  decidedBy?: string;
  decidedAt?: string;
  // Stage 1 — the parent/guardian decision that gates everything after it
  parentDecision?: 'Approved' | 'Rejected' | null;
  parentDecidedAt?: string;
  parentNote?: string;
  awaitingParent?: boolean;
  locationConsent?: boolean;
  pendingStage?: 'Parent/Guardian' | 'Warden' | null;
  canDecide?: boolean;
  // GPS tracking state for an approved outing
  trackingStatus?: TrackingStatus | null;
  trackingLastUpdate?: string | null;
  trackingReason?: string | null;
  // Staff-only fields
  studentName?: string;
  regNumber?: string;
  roomNumber?: string;
  parentName?: string;
  parentPhone?: string;
  parentApprovals?: {
    id: string;
    parentName: string | null;
    parentPhoneMasked: string;
    deliveryStatus: string;
    deliveryError: string | null;
    decision: 'Approved' | 'Rejected' | null;
    decidedAt: string | null;
    note: string | null;
    requestedAt: string;
  }[];
  tracking?: {
    status: TrackingStatus;
    isInterrupted: boolean;
    lastLatitude: number | null;
    lastLongitude: number | null;
    lastUpdateDisplay: string;
    interruptedAt: string | null;
    interruptionReason: string | null;
    stoppedAt: string | null;
    stopReason: string | null;
  } | null;
  history?: HistoryEntry[];
}

export interface Outpass {
  id: string;
  type: 'Leave' | 'Outing';
  title: string;
  dateRange: string;
  timeSlot?: string;
  status: 'Active' | 'Completed' | 'Expired' | 'Cancelled';
  gateCheckOutTime?: string;
  gateCheckInTime?: string;
  gateVerificationDesk: string;
  approvals: string;
  remarks: string;
  isInsideCampus: boolean;
  /** Active = issued, Out = checked out at the gate, Completed = returned */
  lifecycleStatus?: 'Active' | 'Out' | 'Completed' | 'Expired' | 'Cancelled';
  isOverdueReturn?: boolean;
  qrToken?: string;
  sourceId?: string;
  validFrom?: string;
  validUntil?: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  time: string;
  type: 'alert' | 'info' | 'success';
  read: boolean;
  linkTab?: DashboardTab;
}
