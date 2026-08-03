import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

export default function HomePage() {
  return (
    <main className="entry-page" id="main-content">
      <ThemeToggle className="entry-page__theme" />
      <div className="entry-page__content">
        <p className="eyebrow">Restaurant procedures · where work happens</p>
        <h1>
          Clear procedures.
          <br />
          Confident teams.
        </h1>
        <p>
          Build clear restaurant procedures, manage your team, and put the right instructions at
          every station.
        </p>
        <div className="entry-page__actions">
          <Link className="button button--primary" href="/manager">
            Manager sign in
          </Link>
          <Link className="button button--secondary" href="/employee">
            Employee access
          </Link>
        </div>
      </div>
      <aside className="entry-page__panel" aria-label="StationSnap product principles">
        <span className="entry-page__mark" aria-hidden="true">
          S
        </span>
        <p>QR-ready workflows</p>
        <p>English and Spanish</p>
        <p>Secure team access</p>
        <p>Built for the shift</p>
      </aside>
    </main>
  );
}
