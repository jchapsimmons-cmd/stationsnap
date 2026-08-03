import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "@/components/theme-toggle";

describe("Nocturne theme toggle", () => {
  beforeEach(() => {
    document.documentElement.dataset["theme"] = "dark";
    localStorage.clear();
  });

  it("switches between the approved dark and light themes", async () => {
    render(<ThemeToggle />);
    const toggle = screen.getByRole("button", { name: "Toggle color theme" });

    await userEvent.click(toggle);
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(localStorage.getItem("stationsnap-theme")).toBe("light");

    await userEvent.click(toggle);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem("stationsnap-theme")).toBe("dark");
  });
});
