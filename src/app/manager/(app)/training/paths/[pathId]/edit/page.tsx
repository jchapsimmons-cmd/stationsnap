import { PathForm } from "@/components/training/path-form";
import { PageHeader } from "@/components/ui";
import { requireManagerPage } from "@/server/auth/authorization";
import { getPathDetail } from "@/server/training/qualifications";
import { listTrainableSops } from "@/server/training/service";

export default async function EditTrainingPathPage({
  params,
}: {
  params: Promise<{ pathId: string }>;
}) {
  const { pathId } = await params;
  const session = await requireManagerPage(`/manager/training/paths/${pathId}/edit`);
  const [path, sops] = await Promise.all([
    getPathDetail(session, pathId),
    listTrainableSops(session),
  ]);

  return (
    <div className="page-stack">
      <PageHeader
        title={`Edit ${path.title}`}
        description="Location and station are fixed once a path is created. Disable it from the path page instead of here."
      />
      <PathForm path={path} locations={[]} stations={[]} sops={sops} />
    </div>
  );
}
