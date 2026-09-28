"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCandidate, deleteCandidate, updateCandidate } from "./actions";

type Candidate = {
  id: string;
  name: string;
  symbol_key: string;
  color: string;
  display_order: number;
  is_active: boolean;
};

type Election = {
  id: string;
  title: string;
  status: "draft" | "ready" | "live" | "closed";
};

export default function CandidateManagement({ election, candidates }: { election: Election; candidates: Candidate[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canManage = election.status === "draft" || election.status === "ready";
  const nextOrder = candidates.length === 0 ? 0 : Math.max(...candidates.map((candidate) => candidate.display_order)) + 1;

  async function submit(action: (formData: FormData) => Promise<void>, formData: FormData) {
    setError("");
    setBusy(true);
    try {
      await action(formData);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-indigo-600">Candidate roster</p>
          <h2 className="mt-1 text-2xl font-bold">Candidates for {election.title}</h2>
          <p className="mt-1 text-slate-500">{candidates.length} {candidates.length === 1 ? "candidate" : "candidates"} configured</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold capitalize text-slate-700">{election.status}</span>
      </div>

      {error && <div role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}

      {canManage ? (
        <form action={(data) => submit(createCandidate, data)} className="mt-7 grid gap-4 rounded-2xl bg-slate-50 p-5 lg:grid-cols-[1.2fr_1fr_145px_120px_auto] lg:items-end">
          <input type="hidden" name="election_id" value={election.id} />
          <label className="text-sm font-semibold">Candidate name<input name="name" required className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" placeholder="e.g. Aditi Sharma" /></label>
          <label className="text-sm font-semibold">Election symbol<input name="symbol_key" required className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" placeholder="e.g. Book" /></label>
          <label className="text-sm font-semibold">Color<input name="color" required defaultValue="#4f46e5" className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" placeholder="#4f46e5" /></label>
          <label className="text-sm font-semibold">Order<input name="display_order" required type="number" min="0" step="1" defaultValue={nextOrder} className="mt-2 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>
          <div className="flex items-center gap-3 pb-2"><label className="flex items-center gap-2 text-sm font-semibold"><input name="is_active" type="checkbox" defaultChecked className="size-4 accent-indigo-600" />Active</label><button disabled={busy} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">Add candidate</button></div>
        </form>
      ) : <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Candidate changes are locked while this election is {election.status}.</p>}

      {candidates.length === 0 ? <div className="mt-6 rounded-2xl border border-dashed border-slate-300 p-8 text-center"><p className="font-semibold">No candidates yet</p><p className="mt-1 text-sm text-slate-500">Add the first candidate to begin building the ballot.</p></div> : <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {candidates.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} electionId={election.id} canManage={canManage} busy={busy} submit={submit} />)}
      </div>}
    </section>
  );
}

function CandidateCard({ candidate, electionId, canManage, busy, submit }: { candidate: Candidate; electionId: string; canManage: boolean; busy: boolean; submit: (action: (formData: FormData) => Promise<void>, formData: FormData) => Promise<void> }) {
  return <form action={(data) => submit(updateCandidate, data)} className="rounded-2xl border border-slate-200 p-5">
    <input type="hidden" name="candidate_id" value={candidate.id} />
    <input type="hidden" name="election_id" value={electionId} />
    <div className="mb-5 flex items-start gap-3"><span aria-hidden="true" className="mt-1 size-5 rounded-full border-2 border-white shadow ring-1 ring-slate-200" style={{ backgroundColor: candidate.color }} /><div><p className="font-bold">{candidate.name}</p><p className="text-sm text-slate-500">Symbol: {candidate.symbol_key} · Position {candidate.display_order + 1}</p></div><span className={`ml-auto rounded-full px-2.5 py-1 text-xs font-bold ${candidate.is_active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{candidate.is_active ? "Active" : "Inactive"}</span></div>
    {canManage ? <><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold">Name<input name="name" required defaultValue={candidate.name} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label><label className="text-sm font-semibold">Symbol<input name="symbol_key" required defaultValue={candidate.symbol_key} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label><label className="text-sm font-semibold">Color<input name="color" required defaultValue={candidate.color} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label><label className="text-sm font-semibold">Order<input name="display_order" required type="number" min="0" step="1" defaultValue={candidate.display_order} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label></div><div className="mt-4 flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-sm font-semibold"><input name="is_active" type="checkbox" defaultChecked={candidate.is_active} className="size-4 accent-indigo-600" />Active</label><button disabled={busy} className="rounded-lg border border-indigo-200 px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60">Save changes</button><button disabled={busy} formAction={(data) => submit(deleteCandidate, data)} className="rounded-lg px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60">Delete</button></div></> : null}
  </form>;
}
