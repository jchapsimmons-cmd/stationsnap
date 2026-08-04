import Link from "next/link";
import {
  TRAINING_PATH_STATUS_LABELS,
  TRAINING_PATH_STATUS_TONE,
  TRAINING_PATH_VERSION_POLICY_LABELS,
} from "@/components/training/status";
import { PathStatusToggle } from "@/components/training/path-status-toggle";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getPathDetail } from "@/server/training/qualifications";

export default async function ManagerTrainingPathDetailPage({
  params,
}: {
  params: Promise<{ pathId: string }>;
}) {
  const { pathId } = await params;
  const session = await requireManagerPage(`/manager/training/paths/${pathId}`);
  const path = await getPathDetail(session, pathId);

  return (
    <div className="page-stack">
      <PageHeader
        title={path.title}
        description={`${path.locationName}${path.stationName ? ` · ${path.stationName}` : ""}`}
        actions={
          <Link
            className="button button--secondary"
            href={`/manager/training/paths/${path.id}/edit`}
          >
            Edit path
          </Link>
        }
      />

      <Card>
        <div className="action-row">
          <StatusBadge tone={TRAINING_PATH_STATUS_TONE[path.status] ?? "neutral"}>
            {TRAINING_PATH_STATUS_LABELS[path.status] ?? path.status}
          </StatusBadge>
          <StatusBadge tone="neutral">
            {path.enforceOrder ? "Order enforced" : "Any order"}
          </StatusBadge>
        </div>
        {path.description && <p>{path.description}</p>}
      </Card>

      <div className="detail-grid">
        <Card>
          <p className="eyebrow">Qualification</p>
          <strong>{path.definition.name}</strong>
          {path.definition.description && <p>{path.definition.description}</p>}
        </Card>
        <Card>
          <p className="eyebrow">Validity</p>
          <strong>
            {path.definition.defaultValidityDays
              ? `${path.definition.defaultValidityDays} days`
              : "Never expires"}
          </strong>
        </Card>
        <Card>
          <p className="eyebrow">Qualified employees</p>
          <strong>{path.qualificationSummary.active}</strong>
        </Card>
        <Card>
          <p className="eyebrow">Expired</p>
          <strong>{path.qualificationSummary.expired}</strong>
        </Card>
        <Card>
          <p className="eyebrow">Revoked</p>
          <strong>{path.qualificationSummary.revoked}</strong>
        </Card>
      </div>

      <Card className="form-section">
        <h2>Required procedures</h2>
        {path.items.length === 0 ? (
          <p className="muted">This path has no items.</p>
        ) : (
          <ol className="step-list">
            {path.items.map((item, index) => (
              <li key={item.id}>
                <Card className="step-card">
                  <div className="step-card__head">
                    <span className="step-order-badge" aria-hidden="true">
                      {index + 1}
                    </span>
                    <div className="step-card__title">
                      <strong>{item.sopTitle ?? "Untitled SOP"}</strong>
                      <small>
                        {TRAINING_PATH_VERSION_POLICY_LABELS[item.versionPolicy] ??
                          item.versionPolicy}
                      </small>
                    </div>
                    <StatusBadge tone={item.isRequired ? "info" : "neutral"}>
                      {item.isRequired ? "Required" : "Optional"}
                    </StatusBadge>
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card className="form-section">
        <h2>{path.status === "active" ? "Disable this path" : "Reactivate this path"}</h2>
        <p className="muted">
          {path.status === "active"
            ? "A disabled path stops awarding or renewing qualifications, even when employees still complete every required procedure."
            : "Reactivating this path resumes awarding qualifications to employees who complete its required procedures."}
        </p>
        <PathStatusToggle
          pathId={path.id}
          status={path.status}
          title={path.title}
          description={path.description}
          enforceOrder={path.enforceOrder}
          definition={path.definition}
          items={path.items.map((item) => ({
            sopId: item.sopId,
            isRequired: item.isRequired,
            versionPolicy: item.versionPolicy,
          }))}
        />
      </Card>
    </div>
  );
}
