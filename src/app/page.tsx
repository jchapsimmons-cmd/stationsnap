import Link from "next/link";

export default function HomePage() {
  return (
    <main className="entry-page" id="main-content">
      <div className="entry-page__content">
        <p className="eyebrow">StationSnap foundation</p>
        <h1>
          Clear procedures.
          <br />
          Confident teams.
        </h1>
        <p>
          This Phase 1 foundation establishes separate manager and employee experiences. Business
          features will be added in their planned phases.
        </p>
        <div className="entry-page__actions">
          <Link className="button button--primary" href="/manager">
            Open manager layout
          </Link>
          <Link className="button button--secondary" href="/employee">
            Open employee layout
          </Link>
        </div>
      </div>
      <aside className="entry-page__panel" aria-label="Foundation status">
        <span className="entry-page__mark" aria-hidden="true">
          S
        </span>
        <p>Mobile-first</p>
        <p>PostgreSQL-ready</p>
        <p>Strictly typed</p>
        <p>Accessible foundations</p>
      </aside>
    </main>
  );
}
