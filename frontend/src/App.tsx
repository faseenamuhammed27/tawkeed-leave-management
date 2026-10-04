import { Navigate, Route, Routes } from "react-router-dom";

import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { ApplyLeavePage } from "./pages/ApplyLeavePage";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { CalendarPage } from "./pages/CalendarPage";
import { DashboardPage } from "./pages/DashboardPage";
import { HistoryPage } from "./pages/HistoryPage";
import { LoginPage } from "./pages/LoginPage";
import { TeamMembersPage } from "./pages/TeamMembersPage";
import { AllowancesPage } from "./pages/admin/AllowancesPage";
import { AuditLogPage } from "./pages/admin/AuditLogPage";
import { HolidaysPage } from "./pages/admin/HolidaysPage";
import { LeaveTypesPage } from "./pages/admin/LeaveTypesPage";
import { UsersPage } from "./pages/admin/UsersPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="apply" element={<RequireAuth roles={["employee", "manager"]}><ApplyLeavePage /></RequireAuth>} />
        <Route path="history" element={<RequireAuth roles={["employee", "manager"]}><HistoryPage /></RequireAuth>} />
        <Route path="approvals" element={<RequireAuth roles={["manager", "admin"]}><ApprovalsPage /></RequireAuth>} />
        <Route path="calendar" element={<RequireAuth roles={["manager", "admin"]}><CalendarPage /></RequireAuth>} />
        <Route path="team" element={<RequireAuth roles={["manager", "admin"]}><TeamMembersPage /></RequireAuth>} />
        <Route path="admin/users" element={<RequireAuth roles={["admin"]}><UsersPage /></RequireAuth>} />
        <Route path="admin/allowances" element={<RequireAuth roles={["admin"]}><AllowancesPage /></RequireAuth>} />
        <Route path="admin/leave-types" element={<RequireAuth roles={["admin"]}><LeaveTypesPage /></RequireAuth>} />
        <Route path="admin/holidays" element={<RequireAuth roles={["admin"]}><HolidaysPage /></RequireAuth>} />
        <Route path="admin/audit-log" element={<RequireAuth roles={["admin"]}><AuditLogPage /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
