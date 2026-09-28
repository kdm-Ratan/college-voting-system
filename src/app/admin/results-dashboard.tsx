"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type ClosedElection = {
  id: string;
  title: string;
};

type CandidateResult = {
  candidate_id: string;
  name: string;
  symbol_key: string;
  color: string;
  votes: number;
  percentage: number;
};

type ElectionResults = {
  election_id: string;
  election_title: string;
  registered_voters: number;
  votes_cast: number;
  pending_voters: number;
  skipped_voters: number;
  absent_voters: number;
  turnout_percentage: number;
  nota_votes: number;
  nota_percentage: number;
  candidates: CandidateResult[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPercentage(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseResults(value: unknown): ElectionResults {
  if (
    !isRecord(value)
    || typeof value.election_id !== "string"
    || typeof value.election_title !== "string"
    || !isCount(value.registered_voters)
    || !isCount(value.votes_cast)
    || !isCount(value.pending_voters)
    || !isCount(value.skipped_voters)
    || !isCount(value.absent_voters)
    || !isPercentage(value.turnout_percentage)
    || !isCount(value.nota_votes)
    || !isPercentage(value.nota_percentage)
    || !Array.isArray(value.candidates)
  ) {
    throw new Error("The results response was invalid.");
  }

  const candidates = value.candidates.map((candidate: unknown): CandidateResult => {
    if (
      !isRecord(candidate)
      || typeof candidate.candidate_id !== "string"
      || typeof candidate.name !== "string"
      || typeof candidate.symbol_key !== "string"
      || typeof candidate.color !== "string"
      || !isCount(candidate.votes)
      || !isPercentage(candidate.percentage)
    ) {
      throw new Error("The candidate results response was invalid.");
    }

    return {
      candidate_id: candidate.candidate_id,
      name: candidate.name,
      symbol_key: candidate.symbol_key,
      color: candidate.color,
      votes: candidate.votes,
      percentage: candidate.percentage,
    };
  });

  return {
    election_id: value.election_id,
    election_title: value.election_title,
    registered_voters: value.registered_voters,
    votes_cast: value.votes_cast,
    pending_voters: value.pending_voters,
    skipped_voters: value.skipped_voters,
    absent_voters: value.absent_voters,
    turnout_percentage: value.turnout_percentage,
    nota_votes: value.nota_votes,
    nota_percentage: value.nota_percentage,
    candidates,
  };
}

function formatPercentage(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

export default function ResultsDashboard({ elections }: { elections: ClosedElection[] }) {
  const [selectedElectionId, setSelectedElectionId] = useState(elections[0]?.id ?? "");
  const [results, setResults] = useState<ElectionResults | null>(null);
  const [loading, setLoading] = useState(Boolean(elections[0]));
  const [error, setError] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);
  const activeElectionId = elections.some((election) => election.id === selectedElectionId)
    ? selectedElectionId
    : elections[0]?.id ?? "";
  const resultsLoading = loading || Boolean(
    activeElectionId && !error && results?.election_id !== activeElectionId
  );

  useEffect(() => {
    let cancelled = false;

    async function loadResults() {
      if (!activeElectionId) {
        setResults(null);
        setLoading(false);
        setError("");
        return;
      }

      setLoading(true);
      setError("");

      try {
        const supabase = createClient();
        const { data, error: resultsError } = await supabase.rpc("get_election_results", {
          p_election_id: activeElectionId,
        });

        if (resultsError) {
          throw new Error(resultsError.message);
        }

        const parsedResults = parseResults(data);
        if (!cancelled) {
          setResults(parsedResults);
        }
      } catch (reason) {
        if (!cancelled) {
          setResults(null);
          setError(reason instanceof Error ? reason.message : "Could not load election results.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadResults();
    return () => {
      cancelled = true;
    };
  }, [activeElectionId, refreshCount]);

  return (
    <section aria-labelledby="results-heading" className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-indigo-600">Election results</p>
          <h2 id="results-heading" className="mt-1 text-2xl font-bold">Final results</h2>
          <p className="mt-1 text-sm text-slate-600">Aggregate totals only. Individual ballots are never shown.</p>
        </div>
        {elections.length > 0 && (
          <div className="flex flex-wrap items-end gap-3">
            {elections.length > 1 && (
              <label className="text-sm font-semibold" htmlFor="results-election">
                Closed election
                <select
                  id="results-election"
                  value={activeElectionId}
                  onChange={(event) => setSelectedElectionId(event.target.value)}
                  className="mt-1.5 block min-w-56 rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                >
                  {elections.map((election) => (
                    <option key={election.id} value={election.id}>{election.title}</option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              onClick={() => setRefreshCount((count) => count + 1)}
              disabled={loading}
              className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
            >
              Refresh
            </button>
          </div>
        )}
      </div>

      {resultsLoading ? (
        <div aria-busy="true" className="mt-6 rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-600" role="status">
          Loading final results…
        </div>
      ) : error ? (
        <div role="alert" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Could not load results: {error}
        </div>
      ) : elections.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-slate-300 p-7 text-center">
          <p className="font-semibold">No final results yet</p>
          <p className="mt-1 text-sm text-slate-600">Results are available after an election is closed.</p>
        </div>
      ) : results ? (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <h3 className="text-lg font-bold">{results.election_title}</h3>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-blue-700">Closed</span>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Metric label="Registered voters" value={results.registered_voters.toLocaleString()} />
            <Metric label="Votes cast" value={results.votes_cast.toLocaleString()} />
            <Metric label="Turnout" value={formatPercentage(results.turnout_percentage)} />
            <Metric label="Pending voters" value={results.pending_voters.toLocaleString()} />
            <Metric label="Skipped voters" value={results.skipped_voters.toLocaleString()} />
            <Metric label="Absent voters" value={results.absent_voters.toLocaleString()} />
          </div>

          <div className="mt-7">
            <h4 className="text-lg font-bold">Vote totals</h4>
            <p className="mt-1 text-sm text-slate-600">Candidate and NOTA percentages are calculated from votes cast.</p>
            {results.candidates.length === 0 && results.nota_votes === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
                No votes were recorded for this election.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th scope="col" className="px-5 py-3 font-semibold">Option</th>
                      <th scope="col" className="px-5 py-3 text-right font-semibold">Votes</th>
                      <th scope="col" className="px-5 py-3 text-right font-semibold">Percentage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {results.candidates.map((candidate) => (
                      <tr key={candidate.candidate_id}>
                        <th scope="row" className="px-5 py-4 font-normal">
                          <span className="flex items-center gap-3">
                            <span
                              aria-hidden="true"
                              className="size-5 shrink-0 rounded-full border-2 border-white shadow ring-1 ring-slate-200"
                              style={{ backgroundColor: candidate.color }}
                            />
                            <span>
                              <span className="block font-bold text-slate-900">{candidate.name}</span>
                              <span className="text-slate-600">Symbol: {candidate.symbol_key}</span>
                            </span>
                          </span>
                        </th>
                        <td className="px-5 py-4 text-right font-semibold tabular-nums">{candidate.votes.toLocaleString()}</td>
                        <td className="px-5 py-4 text-right font-semibold tabular-nums">{formatPercentage(candidate.percentage)}</td>
                      </tr>
                    ))}
                    <tr className="bg-amber-50/60">
                      <th scope="row" className="px-5 py-4 font-bold">NOTA <span className="font-normal text-slate-600">(None of the Above)</span></th>
                      <td className="px-5 py-4 text-right font-semibold tabular-nums">{results.nota_votes.toLocaleString()}</td>
                      <td className="px-5 py-4 text-right font-semibold tabular-nums">{formatPercentage(results.nota_percentage)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <p className="text-sm text-slate-700">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
    </div>
  );
}
