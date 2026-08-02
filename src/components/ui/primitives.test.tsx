import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, EmptyState, Input, Toggle } from "@/components/ui/primitives";

describe("shared UI primitives", () => {
  it("associates labels and hints with inputs", () => {
    render(<Input id="title" label="SOP title" hint="Use a clear title" />);
    expect(screen.getByLabelText("SOP title")).toHaveAccessibleDescription("Use a clear title");
  });

  it("exposes toggle semantics", () => {
    render(<Toggle id="required" label="Training required" />);
    expect(screen.getByRole("switch", { name: "Training required" })).toBeInTheDocument();
  });

  it("runs button actions", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders a helpful empty state", () => {
    render(<EmptyState title="No SOPs" description="Create the first SOP." />);
    expect(screen.getByRole("heading", { name: "No SOPs" })).toBeInTheDocument();
    expect(screen.getByText("Create the first SOP.")).toBeInTheDocument();
  });
});
