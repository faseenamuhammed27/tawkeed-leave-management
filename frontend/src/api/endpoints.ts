import { api, request } from "./client";
import type {
  AuditLog,
  Balance,
  CalendarEntry,
  Holiday,
  LeavePreview,
  LeaveRequest,
  LeaveStatus,
  LeaveType,
  Page,
  Role,
  TokenResponse,
  User,
  UserBrief,
} from "./types";

const V1 = "/api/v1";

export const authApi = {
  login: (email: string, password: string) =>
    request<TokenResponse>("POST", `${V1}/auth/login`, { body: { email, password }, auth: false }),
  me: () => api.get<User>(`${V1}/auth/me`),
};

export const referenceApi = {
  leaveTypes: () => api.get<LeaveType[]>(`${V1}/leave-types`),
  holidays: (year?: number) => api.get<Holiday[]>(`${V1}/holidays`, { year }),
  myBalances: (year?: number) => api.get<Balance[]>(`${V1}/me/balances`, { year }),
};

export const leaveApi = {
  preview: (params: { start_date: string; end_date: string; leave_type_id?: number }, signal?: AbortSignal) =>
    api.get<LeavePreview>(`${V1}/leave-requests/preview`, params, signal),
  mine: (status?: LeaveStatus) => api.get<LeaveRequest[]>(`${V1}/leave-requests/mine`, { status }),
  create: (body: { leave_type_id: number; start_date: string; end_date: string; reason?: string }) =>
    api.post<LeaveRequest>(`${V1}/leave-requests`, body),
  approve: (id: number, comment?: string) =>
    api.post<LeaveRequest>(`${V1}/leave-requests/${id}/approve`, comment ? { comment } : undefined),
  reject: (id: number, comment: string) => api.post<LeaveRequest>(`${V1}/leave-requests/${id}/reject`, { comment }),
  cancel: (id: number, reason?: string) =>
    api.post<LeaveRequest>(`${V1}/leave-requests/${id}/cancel`, reason ? { reason } : undefined),
};

export const teamApi = {
  members: () => api.get<UserBrief[]>(`${V1}/team/members`),
  requests: (status?: LeaveStatus) => api.get<LeaveRequest[]>(`${V1}/team/leave-requests`, { status }),
  calendar: (start_date: string, end_date: string) =>
    api.get<CalendarEntry[]>(`${V1}/team/calendar`, { start_date, end_date }),
};

export interface UserCreateBody {
  email: string;
  full_name: string;
  password: string;
  role: Role;
  manager_id: number | null;
}

export type UserUpdateBody = Partial<{
  full_name: string;
  role: Role;
  manager_id: number | null;
  is_active: boolean;
  password: string;
}>;

export const adminApi = {
  users: (query?: { role?: Role; is_active?: boolean; search?: string }) => api.get<User[]>(`${V1}/admin/users`, query),
  createUser: (body: UserCreateBody) => api.post<User>(`${V1}/admin/users`, body),
  updateUser: (id: number, body: UserUpdateBody) => api.patch<User>(`${V1}/admin/users/${id}`, body),
  userBalances: (id: number, year: number) => api.get<Balance[]>(`${V1}/admin/users/${id}/balances`, { year }),
  setAllowance: (id: number, body: { leave_type_id: number; year: number; allocated_days: number }) =>
    api.put<Balance>(`${V1}/admin/users/${id}/balances`, body),
  leaveTypes: () => api.get<LeaveType[]>(`${V1}/admin/leave-types`),
  createLeaveType: (body: { code: string; name: string; default_annual_days: number }) =>
    api.post<LeaveType>(`${V1}/admin/leave-types`, body),
  updateLeaveType: (id: number, body: Partial<{ name: string; default_annual_days: number; is_active: boolean }>) =>
    api.patch<LeaveType>(`${V1}/admin/leave-types/${id}`, body),
  createHoliday: (body: { holiday_date: string; name: string }) => api.post<Holiday>(`${V1}/admin/holidays`, body),
  updateHoliday: (id: number, body: Partial<{ holiday_date: string; name: string }>) =>
    api.patch<Holiday>(`${V1}/admin/holidays/${id}`, body),
  deleteHoliday: (id: number) => api.delete<void>(`${V1}/admin/holidays/${id}`),
  auditLogs: (query: { action?: string; entity_type?: string; page: number; page_size: number }) =>
    api.get<Page<AuditLog>>(`${V1}/admin/audit-logs`, query),
};
