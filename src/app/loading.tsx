import { LoadingState } from "@/components/ui";

export default function Loading() {
  return (
    <main className="centered-page" id="main-content">
      <LoadingState label="Loading StationSnap" />
    </main>
  );
}
