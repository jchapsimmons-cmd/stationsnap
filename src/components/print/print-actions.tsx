"use client";

import { Button } from "@/components/ui";

/**
 * Print (browser print dialog) and download-PDF actions shared by every `/manager/print/*` sheet.
 * The PDF link is a plain anchor rather than a JS-driven `window.open` so it survives ad/popup
 * blockers and works with "save link as" — the PDF route handler sets the attachment disposition.
 */
export function PrintActions({ pdfHref }: { pdfHref: string }) {
  return (
    <div className="action-row">
      <Button type="button" onClick={() => window.print()}>
        Print
      </Button>
      <a className="button button--secondary" href={pdfHref}>
        Download PDF
      </a>
    </div>
  );
}
