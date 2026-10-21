/**
 * HOD Portal Types for KVCET Hostel ERP (Scope Corrected: 5 Modules)
 */

import { StudentRecord } from '../types';

export type HODTab = 
  | 'home'
  | 'dashboard'
  | 'students'
  | 'incident-reports'
  | 'reports'
  | 'profile';

export type IncidentStatus = 
  | 'Pending Review'
  | 'Under Investigation'
  | 'Resolved'
  | 'Escalated';

export type IncidentSeverity = 
  | 'Low'
  | 'Medium'
  | 'High'
  | 'Critical';

export interface IncidentReport {
  id: string;
  studentName: string;
  regNumber: string;
  department: string;
  year: string;
  roomNumber: string;
  incidentCategory: string;
  incidentDate: string;
  submittedDate: string;
  reportingWarden: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  location: string;
  description: string;
  actionTakenSoFar: string;
  wardenNotes?: string;
  witnesses?: string[];
  isSampleData: boolean;
  // Detailed modal fields (matching reference screenshot)
  hostel?: string;
  roomType?: string;
  mess?: string;
  currentStatus?: string;
  medicalIssues?: string;
  allergies?: string;
  remarks?: string;
  assignedTo?: string;
  followUpRequired?: string;
  notes?: string;
  attachmentName?: string;
  attachmentSize?: string;
}

export interface HODProfile {
  id: string;
  name: string;
  department: string;
  departmentCode: string;
  email: string;
  role: string;
  designation: string;
  employeeId: string;
  phone: string;
  office: string;
  joinedYear: string;
  qualifications: string;
  specialization: string;
  isDemo: boolean;
}

export interface HODActivityItem {
  id: string;
  title: string;
  sub: string;
  time: string;
  type: 'incident' | 'student' | 'system';
  badge?: string;
}

export interface HODDashboardMetrics {
  totalStudents: number;
  pendingIncidentReports: number;
  underInvestigationReports: number;
  reportsRequiringAttention: number;
}

export type { StudentRecord };
