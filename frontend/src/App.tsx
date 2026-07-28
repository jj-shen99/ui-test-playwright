import { Routes, Route, NavLink, useNavigate, Navigate } from "react-router-dom";
import {
  LayoutDashboard,
  Play,
  List,
  Brain,
  FlaskConical,
  Users as UsersIcon,
  Calendar,
  ClipboardList,
  Wand2,
  Settings,
  BookOpen,
  Sun,
  Moon,
  LogOut,
} from "lucide-react";
import { useTheme } from "./ThemeContext";
import { useCurrentUser, isAdmin, clearCurrentUser } from "./useCurrentUser";
import RunsDashboard from "./views/RunsDashboard";
import RunDetail from "./views/RunDetail";
import TriggerRun from "./views/TriggerRun";
import TestCatalog from "./views/TestCatalog";
import TestHistory from "./views/TestHistory";
import Insights from "./views/Insights";
import Knowledge from "./views/Knowledge";
import Users from "./views/Users";
import Schedules from "./views/Schedules";
import FailureDrillDown from "./views/FailureDrillDown";
import Results from "./views/Results";
import Generate from "./views/Generate";
import SettingsPage, { GeneralSettings } from "./views/Settings";
import AuditLog from "./views/AuditLog";
import AuthProfiles from "./views/AuthProfiles";
import Login from "./views/Login";
import Register from "./views/Register";
import ForgotPassword from "./views/ForgotPassword";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard", adminOnly: false },
  { to: "/generate", icon: Wand2, label: "Generate", adminOnly: false },
  { to: "/tests", icon: List, label: "Test Catalog", adminOnly: false },
  { to: "/trigger", icon: Play, label: "Trigger Run", adminOnly: false },
  { to: "/schedules", icon: Calendar, label: "Schedules", adminOnly: false },
  { to: "/results", icon: ClipboardList, label: "Results", adminOnly: false },
  { to: "/insights", icon: Brain, label: "ML Insights", adminOnly: false },
  { to: "/knowledge", icon: BookOpen, label: "Knowledge", adminOnly: false },
  { to: "/settings", icon: Settings, label: "Settings", adminOnly: false },
  { to: "/users", icon: UsersIcon, label: "Users", adminOnly: true },
];

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const userIsAdmin = isAdmin(currentUser);

  const handleLogout = () => {
    clearCurrentUser();
    navigate("/login");
  };

  const visibleNavItems = navItems.filter(
    (item) => !item.adminOnly || userIsAdmin
  );

  // Unauthenticated: only show login / register / forgot-password
  if (!currentUser) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950">
      {/* Sidebar */}
      <nav className="w-56 shrink-0 bg-gray-900 dark:bg-gray-950 text-gray-300 flex flex-col border-r border-gray-800 dark:border-gray-800">
        <div className="p-4 border-b border-gray-700/50 flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-orange-400" />
          <span className="font-semibold text-white text-sm tracking-tight">
            OODP UI Testing
          </span>
        </div>
        <ul className="flex-1 py-2 space-y-0.5">
          {visibleNavItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-3 mx-2 px-3 py-2 text-sm rounded-lg transition-all ${
                    isActive
                      ? "bg-orange-500/10 text-orange-400 font-medium shadow-sm shadow-orange-500/5"
                      : "text-gray-400 hover:bg-gray-800/60 hover:text-gray-200"
                  }`
                }
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="p-3 border-t border-gray-700/50 space-y-2">
          {currentUser && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400 truncate" title={currentUser.email}>
                {currentUser.name}
              </span>
              <button
                onClick={handleLogout}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-800 transition-colors"
                title="Log out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">v0.1.0</span>
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
              title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            >
              {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-900">
        <Routes>
          <Route path="/" element={<RunsDashboard />} />
          <Route path="/runs/:id" element={<RunDetail />} />
          <Route path="/trigger" element={<TriggerRun />} />
          <Route path="/tests" element={<TestCatalog />} />
          <Route path="/tests/:testId" element={<TestHistory />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="/users" element={<Users />} />
          <Route path="/schedules" element={<Schedules />} />
          <Route path="/generate" element={<Generate />} />
          <Route path="/results" element={<Results />} />
          <Route path="/results/:resultId" element={<FailureDrillDown />} />
          {/* Settings is a tabbed shell; Auth Profiles and Audit Log live
              here as nested (admin-only) tabs. */}
          <Route path="/settings" element={<SettingsPage />}>
            <Route index element={<GeneralSettings />} />
            <Route path="auth-profiles" element={<AuthProfiles />} />
            <Route path="audit" element={<AuditLog />} />
          </Route>
          {/* Redirect the old standalone paths to their new Settings tabs. */}
          <Route
            path="/auth-profiles"
            element={<Navigate to="/settings/auth-profiles" replace />}
          />
          <Route path="/audit" element={<Navigate to="/settings/audit" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
        </Routes>
      </main>
    </div>
  );
}
