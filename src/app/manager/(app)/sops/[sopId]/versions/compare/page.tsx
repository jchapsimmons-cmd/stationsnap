import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { compareSopVersions } from "@/server/sops/service";
import { sopVersionCompareQuerySchema } from "@/server/sops/schemas";

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  description: "Description",
  category: "Category",
  estimatedMinutes: "Estimated minutes",
  difficulty: "Difficulty",
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function diffTone(status: "unchanged" | "changed" | "added" | "removed") {
  if (status === "added") return "success" as const;
  if (status === "removed") return "danger" as const;
  if (status === "changed") return "warning" as const;
  return "neutral" as const;
}

export default async function SopVersionComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ sopId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { sopId } = await params;
  const session = await requireManagerPage(`/manager/sops/${sopId}/versions/compare`);
  const rawQuery = await searchParams;
  const parsedQuery = sopVersionCompareQuerySchema.safeParse({
    from: typeof rawQuery["from"] === "string" ? rawQuery["from"] : "",
    to: typeof rawQuery["to"] === "string" ? rawQuery["to"] : "",
  });

  if (!parsedQuery.success) {
    return (
      <div className="page-stack">
        <PageHeader title="Compare versions" />
        <EmptyState
          title="Choose two versions"
          description="Select a version to compare from the version history page."
        />
      </div>
    );
  }

  const comparison = await compareSopVersions(
    session,
    sopId,
    parsedQuery.data.from,
    parsedQuery.data.to,
  );

  return (
    <div className="page-stack">
      <PageHeader
        title={`Compare v${comparison.from.versionNumber} → v${comparison.to.versionNumber}`}
        description={comparison.to.changeSummary || "No change summary was recorded."}
      />
      <Card>
        <h2>Details</h2>
        {comparison.fieldDiffs.length === 0 ? (
          <p>No detail fields changed.</p>
        ) : (
          <ul className="validation-list">
            {comparison.fieldDiffs.map((diff) => (
              <li key={diff.field}>
                <strong>{FIELD_LABELS[diff.field] ?? diff.field}:</strong>{" "}
                {formatValue(diff.before)} → {formatValue(diff.after)}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <h2>Steps</h2>
        {comparison.stepDiffs.length === 0 ? (
          <p>No steps in either version.</p>
        ) : (
          <ul className="validation-list">
            {comparison.stepDiffs.map((diff, index) => (
              <li key={index}>
                <StatusBadge tone={diffTone(diff.status)}>{diff.status}</StatusBadge>{" "}
                {diff.after?.title ||
                  diff.before?.title ||
                  diff.after?.instruction ||
                  diff.before?.instruction}
                {diff.status === "changed" && diff.changedFields.length > 0 && (
                  <small> — changed: {diff.changedFields.join(", ")}</small>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <h2>Materials and ingredients</h2>
        {comparison.materialDiffs.length === 0 ? (
          <p>No materials or ingredients in either version.</p>
        ) : (
          <ul className="validation-list">
            {comparison.materialDiffs.map((diff, index) => (
              <li key={index}>
                <StatusBadge tone={diffTone(diff.status)}>{diff.status}</StatusBadge>{" "}
                {diff.after?.name || diff.before?.name}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <h2>Warnings</h2>
        {comparison.warningDiffs.length === 0 ? (
          <p>No warnings in either version.</p>
        ) : (
          <ul className="validation-list">
            {comparison.warningDiffs.map((diff, index) => (
              <li key={index}>
                <StatusBadge tone={diffTone(diff.status)}>{diff.status}</StatusBadge>{" "}
                {diff.after?.text || diff.before?.text}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
