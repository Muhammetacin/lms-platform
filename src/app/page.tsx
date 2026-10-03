export default function Home() {
  return (
    <main className="page-shell">
      <section className="welcome-card" aria-labelledby="welcome-title">
        <div className="brand-mark" aria-hidden="true">
          L
        </div>
        <p className="eyebrow">Learning, thoughtfully built</p>
        <h1 id="welcome-title">A better place to learn.</h1>
        <p className="welcome-copy">
          The foundation is in place. The learning experience starts taking
          shape in the next development milestones.
        </p>
        <div className="status-pill">
          <span className="status-dot" aria-hidden="true" />
          Platform foundation
        </div>
      </section>
      <footer className="page-footer">LMS Platform · Built for learning</footer>
    </main>
  );
}
