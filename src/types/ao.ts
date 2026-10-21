import { IncidentReport, IncidentSeverity, IncidentStatus } from './hod';

export type AOTab = 
  | 'dashboard'
  | 'incident-reports'
  | 'escalated-cases'
  | 'maintenance'
  | 'reports'
  | 'notifications'
  | 'profile';

export type WorkOrderStatus = 'Pending' | 'In Progress' | 'Resolved' | 'Overdue';
export type WorkOrderPriority = 'High' | 'Medium' | 'Low';

export interface AOWorkOrder {
  id: string;
  ticketId: string;
  name: string;
  regNumber: string;
  roomNumber: string;
  department: string;
  year: string;
  complaintType: string; // Electrical, Plumbing, Carpentry, Wi-Fi / LAN, Housekeeping, Civil / Masonry
  issueDescription: string;
  location: string;
  status: WorkOrderStatus;
  submittedDateTime: string;
  priority: WorkOrderPriority;
  assignedTechnician?: string;
  technicianContact?: string;
  remarks?: string;
  completedDateTime?: string;
  targetCompletionDate?: string;
  isOverdue?: boolean;
}

export type EscalationStatus = 'Escalated' | 'In Review' | 'Resolved';

export interface AOEscalatedCase {
  id: string;
  ticketId: string;
  caseTitle: string;
  category: string;
  studentName: string;
  regNumber: string;
  roomNumber: string;
  location: string;
  submittedDate: string;
  escalatedDate: string;
  urgency: string;
  priority: 'High' | 'Critical' | 'Medium';
  status: EscalationStatus;
  escalationReason: string;
  description: string;
  authorityRef: string;
  assignedTo?: string;
  timeline: {
    stage: string;
    date: string;
    status: 'completed' | 'current' | 'pending';
    badge?: string;
    actor?: string;
    note?: string;
  }[];
  resolutionNotes?: string;
}

export interface AOProfile {
  id: string;
  name: string;
  role: string;
  email: string;
  employeeId: string;
  office: string;
  phone: string;
  department: string;
  authorityScope: string[];
  joinedYear: string;
  qualifications: string;
}

export interface AONotificationItem {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  type: 'incident' | 'work-order' | 'escalation' | 'system';
  targetTab: AOTab;
  targetId?: string;
  badge?: string;
}

export interface AOActivityItem {
  id: string;
  action: string;
  description: string;
  entityId: string;
  entityType: 'incident' | 'work-order' | 'escalation';
  timestamp: string;
  actor: string;
  statusBadge?: string;
}

export interface AODashboardStats {
  totalIncidentReports: number;
  pendingIncidentReviews: number;
  escalatedCases: number;
  maintenanceWorkOrders: number;
  inProgressWorkOrders: number;
  overdueCases: number;
}
