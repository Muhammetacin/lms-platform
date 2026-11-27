import { LogoutButton } from "@/components/logout-button";

export function PortalAccessNotice({ reason }: { reason: "forbidden" | "unavailable" }) {
  const forbidden = reason === "forbidden";

  return (
    <main className="admin-unavailable">
      <section className="admin-unavailable-card" aria-labelledby="portal-access-title">
        <h1 id="portal-access-title">{forbidden ? "Access unavailable" : "Portal temporarily unavailable"}</h1>
        <p>{forbidden ? "An active organization membership is required." : "Please try again in a little while."}</p>
        <LogoutButton />
      </section>
    </main>
  );
}
