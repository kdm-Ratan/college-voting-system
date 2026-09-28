"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createElection, updateElection, changeElectionStatus } from "./actions";
import { createClient } from "@/lib/supabase/client";
import { formatAdminDateTime } from "@/lib/format-date";
import CandidateManagement from "./candidate-management";
import VoterManagement from "./voter-management";

type Election = {
  id: string;
  title: string;
  status: "draft" | "ready" | "live" | "closed";
  total_voters: number;
  voters_generated_at: string | null;
  started_at: string | null;
  ended_at: string | null;
};

type Candidate = {
  id: string;
  name: string;
  symbol_key: string;
  color: string;
  display_order: number;
  is_active: boolean;
};

type Voter = {
  id: string;
  voter_number: number;
  status: "pending" | "voted" | "skipped" | "absent";
};

const statusText = { draft: "Draft", ready: "Ready", live: "Live", closed: "Closed" };
const statusStyle = {
  draft: "bg-slate-100 text-slate-700", ready: "bg-amber-100 text-amber-800",
  live: "bg-emerald-100 text-emerald-800", closed: "bg-blue-100 text-blue-800",
};

export default function ElectionManagement({ election, candidates, voters }: { election: Election | null; candidates: Candidate[]; voters: Voter[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isEditable = election?.status === "draft" || election?.status === "ready";
  const canStart = Boolean(election && election.total_voters > 0);

  async function submit(action: (data: FormData) => Promise<void>, data: FormData) {
    setError(""); setBusy(true);
    try { await action(data); router.refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Something went wrong."); }
    finally { setBusy(false); }
  }

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        <header className="mb-9 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-600">Campus ballot</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">Election management</h1>
            <p className="mt-1 text-slate-500">Prepare and control your college election.</p>
          </div>
          <button onClick={logout} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">Log out</button>
        </header>

        {error && <div role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          {election ? <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><p className="text-sm font-medium text-slate-500">Current election</p><h2 className="mt-1 text-2xl font-bold">{election.title}</h2></div>
              <span className={`rounded-full px-3 py-1 text-sm font-bold ${statusStyle[election.status]}`}>{statusText[election.status]}</span>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-4"><p className="text-sm text-slate-500">Status</p><p className="mt-1 font-semibold">{statusText[election.status]}</p></div>
              <div className="rounded-xl bg-slate-50 p-4"><p className="text-sm text-slate-500">Configured voters</p><p className="mt-1 font-semibold">{election.total_voters.toLocaleString()}</p></div>
              <div className="rounded-xl bg-slate-50 p-4"><p className="text-sm text-slate-500">Timing</p><p className="mt-1 font-semibold">{election.started_at ? `Started ${formatAdminDateTime(election.started_at)}` : "Not started"}</p>{election.ended_at && <p className="mt-1 text-xs text-slate-500">Closed {formatAdminDateTime(election.ended_at)}</p>}</div>
            </div>

            {isEditable && <form action={(data) => submit(updateElection, data)} className="mt-7 grid gap-4 border-t border-slate-100 pt-6 sm:grid-cols-[1fr_180px_auto] sm:items-end">
              <input type="hidden" name="id" value={election.id} />
              <label className="text-sm font-semibold">Election title<input name="title" required maxLength={160} defaultValue={election.title} className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>
              <label className="text-sm font-semibold">Total voters<input name="total_voters" required type="number" min="0" max="1000000" step="1" defaultValue={election.total_voters} className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>
              <button disabled={busy} className="rounded-xl bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">Save draft</button>
            </form>}

            {election.status !== "closed" && <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-100 pt-6">
              {election.status === "draft" && <StatusButton label="Prepare election" status="ready" id={election.id} submit={submit} />}
              {election.status === "ready" && <><StatusButton label="Return to draft" status="draft" id={election.id} submit={submit} /><StatusButton label="Start election" status="live" id={election.id} submit={submit} primary disabled={!canStart || busy} /></>}
              {election.status === "live" && <StatusButton label="Close election" status="closed" id={election.id} submit={submit} danger />}
            </div>}
            {election.status === "ready" && <p className="mt-3 text-sm text-slate-500">{canStart ? "Review the title and voter total before starting. Voting becomes available only while the election is live." : "Set the voter capacity to at least 1 before starting the election."}</p>}
            {election.status === "closed" && <div className="mt-7 grid gap-6 border-t border-slate-100 pt-6 lg:grid-cols-[1fr_1.2fr] lg:items-center">
              <div>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">Election archived</span>
                <h3 className="mt-3 text-xl font-bold">Create the next election</h3>
                <p className="mt-1 text-sm leading-6 text-slate-500">This closed election remains available as historical context. Creating the next election starts a separate Draft with its own candidates.</p>
              </div>
              <form action={(data) => submit(createElection, data)} className="grid gap-3 rounded-2xl bg-slate-50 p-5 sm:grid-cols-[1fr_150px_auto] sm:items-end">
                <label className="text-sm font-semibold">Election title<input name="title" required maxLength={160} placeholder="e.g. Student Council Election 2027" className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>
                <label className="text-sm font-semibold">Total voters<input name="total_voters" required type="number" min="0" max="1000000" step="1" defaultValue="0" className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>
                <button disabled={busy} className="rounded-xl bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{busy ? "Creating…" : "Create New Election"}</button>
              </form>
            </div>}
          </> : <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-center">
            <div><span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-700">No election yet</span><h2 className="mt-4 text-2xl font-bold">Create your first election</h2><p className="mt-2 max-w-md text-slate-600">Set a title and voter capacity. The election starts in Draft so it can be prepared before opening.</p></div>
            <form action={(data) => submit(createElection, data)} className="grid gap-4">
              <label className="text-sm font-semibold">Election title<input name="title" required maxLength={160} placeholder="e.g. Student Council Election 2026" className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>
              <label className="text-sm font-semibold">Total voters<input name="total_voters" required type="number" min="0" max="1000000" step="1" defaultValue="0" className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>
              <button disabled={busy} className="rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{busy ? "Creating…" : "Create draft election"}</button>
            </form>
          </div>}
        </section>
        {election && <CandidateManagement election={election} candidates={candidates} />}
        {election && <VoterManagement election={election} voters={voters} />}
        <section className="grid gap-4 sm:grid-cols-3">
          {[["01", "Draft", "Set up election details."], ["02", "Ready", "Prepare for opening."], ["03", "Live", "Accept votes until closed."]].map(([number, title, detail]) => <div key={number} className="rounded-2xl border border-slate-200 bg-white p-5"><span className="text-sm font-bold text-indigo-600">{number}</span><h3 className="mt-2 font-bold">{title}</h3><p className="mt-1 text-sm text-slate-500">{detail}</p></div>)}
        </section>
      </div>
    </main>
  );
}

function StatusButton({ label, status, id, submit, primary, danger, disabled }: { label: string; status: string; id: string; submit: (action: typeof changeElectionStatus, data: FormData) => Promise<void>; primary?: boolean; danger?: boolean; disabled?: boolean }) {
  return <form action={(data) => submit(changeElectionStatus, data)}>
    <input type="hidden" name="id" value={id} /><input type="hidden" name="status" value={status} />
    <button disabled={disabled} className={`rounded-xl px-5 py-2.5 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${primary ? "bg-emerald-600 text-white hover:bg-emerald-700" : danger ? "bg-rose-600 text-white hover:bg-rose-700" : "border border-slate-300 bg-white hover:bg-slate-50"}`}>{label}</button>
  </form>;
}
