"use client";

import { Moon, Sun } from "@phosphor-icons/react";

type Theme = "dark" | "light";

function applyTheme(theme: Theme) {
  document.documentElement.dataset["theme"] = theme;
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem("stationsnap-theme", theme);
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  function toggle() {
    const next = document.documentElement.dataset["theme"] === "dark" ? "light" : "dark";
    applyTheme(next);
  }

  return (
    <button
      className={`theme-toggle ${className}`}
      type="button"
      onClick={toggle}
      aria-label="Toggle color theme"
      title="Toggle color theme"
    >
      <span className="theme-toggle__dark">
        <Sun size={19} aria-hidden="true" />
      </span>
      <span className="theme-toggle__light">
        <Moon size={19} aria-hidden="true" />
      </span>
    </button>
  );
}
