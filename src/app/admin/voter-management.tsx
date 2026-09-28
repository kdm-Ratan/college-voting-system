"use client";

import { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createVoter, generateVoters, issueVoterPin, markVoterUnavailable } from "./actions";
import { formatAdminDateTime } from "@/lib/format-date";

type Election = {
  id: string;
  title: string;
  status: "draft" | "ready" | "live" | "closed";
  total_voters: number;
  voters_generated_at: string | null;
};

type Voter = {
  id: string;
  voter_number: number;
  status: "pending" | "voted" | "skipped" | "absent";
};

const statusStyles = {
  pending: "bg-amber-100 text-amber-800",
  voted: "bg-emerald-100 text-emerald-800",
  skipped: "bg-slate-200 text-slate-700",
  absent: "bg-rose-100 text-rose-800",
};

export default function VoterManagement({ election, voters }: { election: Election; voters: Voter[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [issuedPin, setIssuedPin] = useState<{ voterId: string; value: string } | null>(null);
  const canManage = election.status === "draft" || election.status === "ready";
  const canMarkAbsentDuringLive = election.status === "live";
  const canIssuePins = canManage || canMarkAbsentDuringLive;
  const remaining = Math.max(election.total_voters - voters.length, 0);

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

  async function issuePin(voterId: string, voterNumber: number) {
    if (!window.confirm(`Generate a new PIN for voter #${voterNumber}? Any previous PIN for this voter will stop working.`)) {
      return;
    }

    setError("");
    setIssuedPin(null);
    setBusy(true);
    try {
      const value = await issueVoterPin(election.id, voterId);
      setIssuedPin({ voterId, value });
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The voter PIN could not be issued.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-indigo-600">Voter roster</p>
          <h2 className="mt-1 text-2xl font-bold">Voters for {election.title}</h2>
          <p className="mt-1 text-slate-500">Voter numbers track eligibility and participation only. Ballot choices remain separate.</p>
          <p className="mt-1 text-sm text-slate-500">Issue each pending voter a PIN and deliver it privately. A newly generated PIN is shown only once.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold capitalize text-slate-700">{election.status}</span>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Metric label="Capacity" value={election.total_voters} />
        <Metric label="Configured" value={voters.length} />
        <Metric label="Remaining" value={remaining} />
      </div>

      {error && <div role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}

      {canManage ? <div className="mt-6 grid gap-4 rounded-2xl bg-slate-50 p-5 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="font-semibold">Generate sequential voter numbers</p>
          <p className="mt-1 text-sm text-slate-500">Creates any missing numbers from 1 through {election.total_voters}. Existing voter statuses are kept.</p>
          {election.voters_generated_at && <p className="mt-2 text-xs text-slate-500">Last generated {formatAdminDateTime(election.voters_generated_at)}</p>}
        </div>
        <form action={(data) => submit(generateVoters, data)}><input type="hidden" name="election_id" value={election.id} /><button disabled={busy || election.total_voters < 1} className="rounded-xl bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60">Generate voters</button></form>
      </div> : <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {canMarkAbsentDuringLive
          ? "Voter roster changes are locked while voting is live. A pending voter may still be marked absent if they are not present."
          : `Voter roster changes are locked while this election is ${election.status}.`}
      </p>}

      {canManage && <form action={(data) => submit(createVoter, data)} className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-5">
        <input type="hidden" name="election_id" value={election.id} />
        <label className="text-sm font-semibold">Add one voter number<input name="voter_number" required type="number" min="1" max={election.total_voters} step="1" className="mt-2 block w-48 rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" placeholder="e.g. 7" /></label>
        <button disabled={busy || election.total_voters < 1} className="rounded-xl border border-indigo-200 px-4 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60">Add voter</button>
      </form>}

      {voters.length === 0 ? <div className="mt-6 rounded-2xl border border-dashed border-slate-300 p-8 text-center"><p className="font-semibold">No voters configured yet</p><p className="mt-1 text-sm text-slate-500">Generate the roster to create voter numbers 1 through {election.total_voters}.</p></div> : <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
        <table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-semibold">Voter number</th><th className="px-5 py-3 font-semibold">Status</th><th className="px-5 py-3 text-right font-semibold">Action</th></tr></thead><tbody className="divide-y divide-slate-100 bg-white">{voters.map((voter) => <tr key={voter.id}><td className="px-5 py-4 font-bold">#{voter.voter_number}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${statusStyles[voter.status]}`}>{voter.status}</span></td><td className="px-5 py-4 text-right">{voter.status === "pending" && canIssuePins ? <div className="flex flex-col items-end gap-2"><span className="inline-flex flex-wrap justify-end gap-2"><button type="button" onClick={() => void issuePin(voter.id, voter.voter_number)} disabled={busy} className="rounded-lg border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:cursor-wait disabled:opacity-60">{busy ? "Working…" : "Generate / reset PIN"}</button>{canManage && <VoterAction label="Skip" status="skipped" electionId={election.id} voterId={voter.id} voterNumber={voter.voter_number} busy={busy} submit={submit} />}<VoterAction label="Mark absent" status="absent" electionId={election.id} voterId={voter.id} voterNumber={voter.voter_number} busy={busy} submit={submit} /></span>{issuedPin?.voterId === voter.id && <span role="status" className="rounded-lg bg-indigo-50 px-3 py-2 text-left text-xs text-indigo-900"><span className="block font-semibold">Share this PIN privately</span><code className="mt-1 block font-mono text-base font-bold tracking-widest">{issuedPin.value}</code><span className="block">It will not be shown again.</span></span>}</div> : <span className="text-slate-400">—</span>}</td></tr>)}</tbody></table>
      </div>}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl bg-slate-50 p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold">{value.toLocaleString()}</p></div>;
}

function VoterAction({ label, status, electionId, voterId, voterNumber, busy, submit }: { label: string; status: "skipped" | "absent"; electionId: string; voterId: string; voterNumber: number; busy: boolean; submit: (action: (formData: FormData) => Promise<void>, formData: FormData) => Promise<void> }) {
  function confirmStatusChange(event: FormEvent<HTMLFormElement>) {
    const message = status === "absent"
      ? `Mark voter #${voterNumber} as absent? They will no longer be able to vote in this election.`
      : `Mark voter #${voterNumber} as skipped? They will no longer be able to vote in this election.`;
    if (!window.confirm(message)) event.preventDefault();
  }

  return <form onSubmit={confirmStatusChange} action={(data) => submit(markVoterUnavailable, data)}><input type="hidden" name="election_id" value={electionId} /><input type="hidden" name="voter_id" value={voterId} /><input type="hidden" name="status" value={status} /><button type="submit" disabled={busy} className={`rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-60 ${status === "absent" ? "text-rose-700 hover:bg-rose-50" : "text-slate-700 hover:bg-slate-100"}`}>{busy ? "Saving…" : label}</button></form>;
}
