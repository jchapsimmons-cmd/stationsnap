import Link from "next/link";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { listSopVersions } from "@/server/sops/service";

function statusTone(status: string): "success" | "warning" | "info" {
  if (status === "published") return "success";
  if (status === "archived") return "warning";
  return "info";
}

export default async function SopVersionsPage({ params }: { params: Promise<{ sopId: string }> }) {
  const { sopId } = await params;
  const session = await requireManagerPage(`/manager/sops/${sopId}/versions`);
  const { versions, currentVersionId } = await listSopVersions(session, sopId);

  return (
    <div className="page-stack">
      <PageHeader
        title="Version history"
        description="Published versions are immutable. Restoring or editing always clones into a new draft."
      />
      {versions.length === 0 ? (
        <EmptyState title="No versions yet" description="This SOP has no version history." />
      ) : (
        <Card>
          <form method="get" action={`/manager/sops/${sopId}/versions/compare`}>
            <div className="table-scroll" tabIndex={0}>
              <table className="data-table">
                <caption className="sr-only">Version history, with compare selection</caption>
                <thead>
                  <tr>
                    <th scope="col">Version</th>
                    <th scope="col">Status</th>
                    <th scope="col">Title</th>
                    <th scope="col">Published</th>
                    <th scope="col">Compare from</th>
                    <th scope="col">Compare to</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((version, index) => (
                    <tr key={version.id}>
                      <td>
                        <Link href={`/manager/sops/${sopId}/versions/${version.id}`}>
                          v{version.versionNumber}
                        </Link>
                        {version.id === currentVersionId && (
                          <>
                            {" "}
                            <StatusBadge tone="success">Current</StatusBadge>
                          </>
                        )}
                      </td>
                      <td>
                        <StatusBadge tone={statusTone(version.status)}>
                          {version.status}
                        </StatusBadge>
                      </td>
                      <td>{version.title}</td>
                      <td>
                        {version.publishedAt
                          ? new Date(version.publishedAt).toLocaleString()
                          : "Not published"}
                      </td>
                      <td>
                        <input
                          type="radio"
                          name="from"
                          value={version.id}
                          aria-label={`Compare from version ${version.versionNumber}`}
                          defaultChecked={index === 1}
                        />
                      </td>
                      <td>
                        <input
                          type="radio"
                          name="to"
                          value={version.id}
                          aria-label={`Compare to version ${version.versionNumber}`}
                          defaultChecked={index === 0}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="action-row">
              <button
                className="button button--secondary"
                type="submit"
                disabled={versions.length < 2}
              >
                Compare selected versions
              </button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
