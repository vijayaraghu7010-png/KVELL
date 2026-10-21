/**
 * KVCET Hostel ERP — Adviser Portal (Department In-Charge) Types
 */

export type AdviserTab = 
  | 'dashboard'
  | 'students'
  | 'leave-requests'
  | 'incident-reports'
  | 'reports';

export interface AdviserProfile {
  id: string;
  name: string;
  staffId: string;
  department: string;
  departmentCode: string;
  officialEmail: string;
  designation: string;
  phone: string;
  office: string;
  assignedYear: string;
  joinedYear: string;
  qualifications: string;
  isDemo: boolean;
}

export interface AdviserLeaveRequest {
  id: string;
  studentName: string;
  regNumber: string;
  department: string;
  year: string;
  roomNumber: string;
  leaveType: string;
  reason: string;
  fromDate: string;
  toDate: string;
  dateRange: string;
  submittedDate: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  hasDocument?: boolean;
  documentName?: string;
  parentName?: string;
  parentNumber?: string;
  addressDuringLeave?: string;
  parentApproved?: boolean;
  parentApprovalDate?: string;
  adviserDecision?: 'Approved' | 'Rejected' | 'Recommended & Forwarded';
  adviserRemarks?: string;
  decisionDate?: string;
  decisionBy?: string;
  workflowStage?: string;
}

export interface AdviserMetrics {
  departmentStudents: number;
  pendingLeaveRequests: number;
  approvedLeaves: number;
  incidentReports: number;
}

export interface AdviserActivityItem {
  id: string;
  type: 'leave_submitted' | 'leave_approved' | 'leave_rejected' | 'leave_forwarded' | 'incident_reported';
  title: string;
  description: string;
  timestamp: string;
  relatedStudentName?: string;
  relatedRegNumber?: string;
  badge?: string;
  badgeType?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}
