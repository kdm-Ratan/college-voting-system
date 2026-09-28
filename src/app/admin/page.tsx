import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ElectionManagement from "./election-management";
import ResultsDashboard from "./results-dashboard";

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") redirect("/");

  const { data: elections, error } = await supabase
    .from("elections")
    .select("id, title, status, total_voters, voters_generated_at, started_at, ended_at, created_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Could not load election details: ${error.message}`);
  const election = elections?.[0] ?? null;
  const closedElections = (elections ?? [])
    .filter((item) => item.status === "closed")
    .map(({ id, title }) => ({ id, title }));

  const [{ data: candidates, error: candidatesError }, { data: voters, error: votersError }] = election
    ? await Promise.all([
      supabase
        .from("candidates")
        .select("id, name, symbol_key, color, display_order, is_active")
        .eq("election_id", election.id)
        .order("display_order", { ascending: true }),
      supabase
        .from("voters")
        .select("id, voter_number, status")
        .eq("election_id", election.id)
        .order("voter_number", { ascending: true }),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (candidatesError) throw new Error(`Could not load candidates: ${candidatesError.message}`);
  if (votersError) throw new Error(`Could not load voters: ${votersError.message}`);

  return <>
    <nav aria-label="Election workspace sections" className="sticky top-0 z-20 border-b border-slate-200 bg-[#f4f7fb]">
      <div className="mx-auto flex w-full min-w-0 max-w-6xl gap-1 overflow-x-auto px-5 py-2 sm:px-8">
        {[
          ["election-section", "Overview"],
          ["candidates-section", "Candidates"],
          ["voters-section", "Voters"],
          ["results-section", "Results"],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="min-h-10 shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-white hover:text-indigo-700">
            {label}
          </a>
        ))}
      </div>
    </nav>
    <div className="mx-auto w-full min-w-0 max-w-6xl px-5 pt-8 sm:px-8">
      <ResultsDashboard elections={closedElections} />
    </div>
    <ElectionManagement election={election} candidates={candidates ?? []} voters={voters ?? []} />
  </>;
}
