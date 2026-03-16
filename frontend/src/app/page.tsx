import Link from "next/link";
import { fetchProfessions } from "@/lib/api";

export default async function DashboardPage() {
  const professions = await fetchProfessions();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Auction House Analytics</h1>

      <section>
        <h2 className="text-lg font-semibold mb-4 text-muted">Professions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {professions.map((prof) => (
            <Link key={prof.id} href={`/professions/${prof.id}`} className="block p-4 rounded-lg border border-border bg-card hover:bg-card-hover transition-colors">
              <h3 className="font-medium text-foreground">{prof.name}</h3>
              <p className="text-sm text-muted mt-1">{prof.expansion}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
