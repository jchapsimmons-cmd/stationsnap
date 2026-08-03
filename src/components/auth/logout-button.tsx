"use client";

import { useState } from "react";
import { Button } from "@/components/ui/primitives";

export function LogoutButton({ kind }: { kind: "manager" | "employee" }) {
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    try {
      const response = await fetch(`/api/auth/${kind}/logout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const body = (await response.json()) as { ok: boolean; data?: { redirectTo?: string } };
      window.location.assign(body.data?.redirectTo ?? "/");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button className="app-bar__logout" variant="ghost" onClick={logout} disabled={pending}>
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
