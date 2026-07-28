import { AlertTriangle, ShieldAlert, Activity } from "lucide-react";
import { healthBadge, type TestHealthEntry } from "../testHealth";

const SEVERITY_STYLES: Record<string, string> = {
  quarantined: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  flaky: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  watch: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  healthy: "",
};

/**
 * Renders a small flaky / quarantine badge for a test (#10). Returns null when
 * the test is healthy (nothing worth surfacing) or has no health data.
 */
export default function HealthBadge({
  health,
  className = "",
}: {
  health: TestHealthEntry | undefined | null;
  className?: string;
}) {
  const badge = healthBadge(health);
  if (!badge) return null;

  const Icon =
    badge.severity === "quarantined"
      ? ShieldAlert
      : badge.severity === "flaky"
        ? AlertTriangle
        : Activity;

  return (
    <span
      title={badge.title}
      className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${SEVERITY_STYLES[badge.severity]} ${className}`}
    >
      <Icon className="w-3 h-3" />
      {badge.label}
    </span>
  );
}
