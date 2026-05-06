import { useEffect } from "react";
import { useGetTeamSettings } from "@workspace/api-client-react";

const HSL_RE = /^\d{1,3}\s+\d{1,3}%\s+\d{1,3}%$/;

function applyVar(name: string, value: string | null | undefined) {
  if (value && HSL_RE.test(value)) {
    document.documentElement.style.setProperty(name, value);
  } else {
    document.documentElement.style.removeProperty(name);
  }
}

export function TeamThemeApplier() {
  const { data } = useGetTeamSettings();
  const primary = data?.primaryColor ?? null;
  const secondary = data?.secondaryColor ?? null;

  useEffect(() => {
    applyVar("--primary", primary);
    applyVar("--ring", primary);
    applyVar("--accent", secondary);
    applyVar("--sidebar-primary", secondary);
    applyVar("--sidebar-ring", secondary);
    return () => {
      document.documentElement.style.removeProperty("--primary");
      document.documentElement.style.removeProperty("--ring");
      document.documentElement.style.removeProperty("--accent");
      document.documentElement.style.removeProperty("--sidebar-primary");
      document.documentElement.style.removeProperty("--sidebar-ring");
    };
  }, [primary, secondary]);

  return null;
}
