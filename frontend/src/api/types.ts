// Mirrors the FastAPI response/request schemas (see /docs on the API).

export type Role = "employee" | "manager" | "admin";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  manager_id: number | null;
  manager_name: string | null;
  is_active: boolean;
}

export interface UserBrief {
  id: number;
  full_name: string;
  email: string;
  role: Role;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export interface LeaveType {
  id: number;
  code: string;
  name: string;
  default_annual_days: number;
  is_active: boolean;
}

export interface Holiday {
  id: number;
  holiday_date: string;
  name: string;
}

export interface Balance {
  leave_type_id: number;
  leave_type_code: string;
  leave_type_name: string;
  year: number;
  allocated_days: number;
  used_days: number;
  pending_days: number;
  available_days: number;
}

export interface LeavePreview {
  start_date: string;
  end_date: string;
  working_days: number;
  calendar_days: number;
  weekend_days: number;
  holidays: { date: string; name: string }[];
  starts_in_past: boolean;
  available_days: number | null;
  exceeds_balance: boolean | null;
}

export interface LeaveRequest {
  id: number;
  employee_id: number;
  employee_name: string;
  employee_role: Role;
  employee_is_active: boolean;
  leave_type_id: number;
  leave_type_code: string;
  leave_type_name: string;
  start_date: string;
  end_date: string;
  working_days: number;
  reason: string | null;
  status: LeaveStatus;
  decided_by_id: number | null;
  decided_by_name: string | null;
  decision_comment: string | null;
  decided_at: string | null;
  cancelled_by_id: number | null;
  cancelled_by_name: string | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  created_at: string;
}

export interface StatusCounts {
  pending: number;
  approved: number;
  rejected: number;
  cancelled: number;
}

export interface MemberLeaveType {
  leave_type_id: number;
  leave_type_code: string;
  leave_type_name: string;
  allocated_days: number;
  used_days: number;
  pending_days: number;
  available_days: number;
  requests: StatusCounts;
}

export interface MemberLeaveSummary {
  id: number;
  full_name: string;
  email: string;
  role: Role;
  manager_name: string | null;
  year: number;
  leave_types: MemberLeaveType[];
  totals: StatusCounts;
}

export interface CalendarEntry {
  request_id: number;
  employee_id: number;
  employee_name: string;
  leave_type_code: string;
  leave_type_name: string;
  start_date: string;
  end_date: string;
  working_days: number;
}

export interface AuditLog {
  id: number;
  actor_id: number | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: number;
  details: Record<string, unknown>;
  created_at: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}
