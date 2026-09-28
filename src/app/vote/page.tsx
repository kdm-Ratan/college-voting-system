"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Candidate = {
  id: string;
  name: string;
  symbol_key: string;
  color: string;
  display_order: number;
};

type Ballot = {
  election_title: string;
  candidates: Candidate[];
};

type Outcome = "voted" | "skipped";
type LoadStatus = "loading" | "ready" | "unavailable" | "error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLiveBallot(data: unknown): Ballot | null {
  if (!Array.isArray(data)) {
    throw new Error("The live ballot response was invalid.");
  }
  if (data.length === 0) {
    return null;
  }
  if (data.length !== 1) {
    throw new Error("The live ballot response contained multiple elections.");
  }

  const row: unknown = data[0];
  if (!isRecord(row) || typeof row.election_title !== "string" || !Array.isArray(row.candidates)) {
    throw new Error("The live ballot response was invalid.");
  }

  const candidates = row.candidates.map((value: unknown): Candidate => {
    if (
      !isRecord(value)
      || typeof value.id !== "string"
      || typeof value.name !== "string"
      || typeof value.symbol_key !== "string"
      || typeof value.color !== "string"
      || typeof value.display_order !== "number"
    ) {
      throw new Error("The live ballot contained an invalid candidate.");
    }

    return {
      id: value.id,
      name: value.name,
      symbol_key: value.symbol_key,
      color: value.color,
      display_order: value.display_order,
    };
  });

  return {
    election_title: row.election_title,
    candidates,
  };
}

function parseVoterNumber(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const parsedNumber = Number(value);
  return Number.isSafeInteger(parsedNumber) && parsedNumber > 0 ? parsedNumber : null;
}

export default function VotePage() {
  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [voterNumber, setVoterNumber] = useState("");
  const [voterPin, setVoterPin] = useState("");
  const [eligible, setEligible] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<"candidate" | "skip" | null>(null);
  const [error, setError] = useState("");
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const operationInProgress = useRef(false);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const ballotHeadingRef = useRef<HTMLHeadingElement>(null);
  const outcomeHeadingRef = useRef<HTMLHeadingElement>(null);
  const voterNumberInputRef = useRef<HTMLInputElement>(null);
  const nextVoterFocusRef = useRef(false);
  const selectedCandidate = ballot?.candidates.find((candidate) => candidate.id === selection) ?? null;

  useEffect(() => {
    if (reviewing) {
      reviewHeadingRef.current?.focus();
    } else if (eligible) {
      ballotHeadingRef.current?.focus();
    }
  }, [eligible, reviewing]);

  useEffect(() => {
    if (outcome) {
      outcomeHeadingRef.current?.focus();
    } else if (nextVoterFocusRef.current) {
      nextVoterFocusRef.current = false;
      voterNumberInputRef.current?.focus();
    }
  }, [outcome]);

  useEffect(() => {
    let cancelled = false;

    async function loadBallot() {
      try {
        const supabase = createClient();
        const { data, error: ballotError } = await supabase.rpc("get_live_ballot");
        if (cancelled) {
          return;
        }
        if (ballotError) {
          setError("Voting is temporarily unavailable. Please ask an election official for help.");
          setLoadStatus("error");
          return;
        }

        const liveBallot = parseLiveBallot(data);
        if (!liveBallot) {
          setLoadStatus("unavailable");
          return;
        }

        setBallot(liveBallot);
        setLoadStatus("ready");
      } catch {
        if (cancelled) {
          return;
        }
        setError("Voting is temporarily unavailable. Please ask an election official for help.");
        setLoadStatus("error");
      }
    }

    void loadBallot();
    return () => {
      cancelled = true;
    };
  }, []);

  async function confirmVoter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const parsedNumber = parseVoterNumber(voterNumber);
    if (parsedNumber === null) {
      setError("Enter a valid voter number using digits only.");
      return;
    }
    if (!/^\d{12}$/.test(voterPin)) {
      setError("Enter the 12-digit PIN provided by an election official.");
      return;
    }
    if (operationInProgress.current) {
      return;
    }

    operationInProgress.current = true;
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { data, error: eligibilityError } = await supabase.rpc("is_live_voter_eligible", {
        p_voter_number: parsedNumber,
        p_voter_pin: voterPin,
      });

      if (eligibilityError || data !== true) {
        setEligible(false);
        setError("The voter number and PIN could not be verified. Check both or ask an election official for help.");
        return;
      }

      setEligible(true);
    } catch {
      setEligible(false);
      setError("We couldn't verify these credentials. Please try again or ask an election official for help.");
    } finally {
      operationInProgress.current = false;
      setSubmitting(false);
    }
  }

  async function submitVote(skip: boolean) {
    setError("");
    const parsedNumber = parseVoterNumber(voterNumber);
    if (!eligible || parsedNumber === null) {
      setError("Confirm an eligible voter number before submitting.");
      return;
    }
    if (!skip && !selection) {
      setError("Choose one candidate or NOTA.");
      return;
    }
    if (operationInProgress.current) {
      return;
    }

    operationInProgress.current = true;
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { data, error: submitError } = await supabase.rpc("submit_anonymous_vote", {
        p_voter_number: parsedNumber,
        p_voter_pin: voterPin,
        p_candidate_id: skip || selection === "nota" ? null : selection,
        p_is_nota: !skip && selection === "nota",
        p_skip: skip,
      });
      const expectedOutcome: Outcome = skip ? "skipped" : "voted";

      if (submitError || data !== expectedOutcome) {
        setEligible(false);
        setSelection(null);
        setReviewing(null);
        setError("We couldn't confirm that your ballot was recorded. Please contact an election official before trying again.");
        return;
      }

      setOutcome(expectedOutcome);
    } catch {
      setEligible(false);
      setSelection(null);
      setReviewing(null);
      setError("We couldn't confirm that your ballot was recorded. Please contact an election official before trying again.");
    } finally {
      operationInProgress.current = false;
      setSubmitting(false);
    }
  }

  function prepareNextVoter() {
    nextVoterFocusRef.current = true;
    setVoterNumber("");
    setVoterPin("");
    setEligible(false);
    setSelection(null);
    setReviewing(null);
    setError("");
    setOutcome(null);
  }

  if (loadStatus === "loading") {
    return (
      <main aria-busy="true" className="min-h-screen bg-[#f4f7fb] p-6 text-slate-600">
        <div className="mx-auto flex max-w-3xl justify-end">
          <Link href="/admin" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-white hover:text-indigo-700">
            Administrator Login
          </Link>
        </div>
        <div className="grid min-h-[80vh] place-items-center">
          <p role="status">Loading ballot…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f4f7fb] px-5 py-8 text-slate-900 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <header className="mb-7 sm:mb-9">
          <div className="mb-3 flex justify-end">
            <Link href="/admin" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-white hover:text-indigo-700">
              Administrator Login
            </Link>
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-600">Campus Ballot</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Cast your vote</h1>
            {ballot && <p className="mt-2 text-lg text-slate-600">{ballot.election_title}</p>}
          </div>
        </header>

        {outcome ? (
          <section className="rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm sm:p-10" role="status">
            <div aria-hidden="true" className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div>
            <h2 ref={outcomeHeadingRef} tabIndex={-1} className="mt-5 text-2xl font-bold focus:outline-none">
              {outcome === "voted" ? "Your vote has been recorded." : "Your ballot was skipped."}
            </h2>
            <p className="mx-auto mt-3 max-w-md text-slate-600">
              {outcome === "voted"
                ? "Your vote is anonymous. Thank you for participating."
                : "Thank you for letting us know."}
            </p>
            <button
              type="button"
              onClick={prepareNextVoter}
              className="mt-6 rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:ring-offset-2"
            >
              Next voter
            </button>
          </section>
        ) : loadStatus === "unavailable" ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-10">
            <h2 className="text-xl font-bold">Voting is currently unavailable</h2>
            <p className="mt-2 text-slate-600">Please return when an election is live.</p>
          </section>
        ) : (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            {error && (
              <div role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {error}
              </div>
            )}

            {!eligible ? (
              <form onSubmit={confirmVoter} className="mx-auto max-w-md">
                <h2 className="text-xl font-bold">Enter your voter number and PIN</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Your credentials are checked only to confirm that you may vote. They are never stored with your ballot.
                </p>
                <label className="mt-6 block text-sm font-semibold" htmlFor="voter-number">
                  Voter number
                </label>
                <input
                  ref={voterNumberInputRef}
                  id="voter-number"
                  value={voterNumber}
                  onChange={(event) => {
                    setVoterNumber(event.target.value);
                    setError("");
                  }}
                  required
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  className="mt-2 block w-full rounded-xl border border-slate-300 px-4 py-3 text-xl font-semibold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Enter your number"
                />
                <label className="mt-5 block text-sm font-semibold" htmlFor="voter-pin">
                  12-digit PIN
                </label>
                <input
                  id="voter-pin"
                  value={voterPin}
                  onChange={(event) => {
                    setVoterPin(event.target.value.replace(/\D/g, "").slice(0, 12));
                    setError("");
                  }}
                  required
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{12}"
                  maxLength={12}
                  autoComplete="off"
                  className="mt-2 block w-full rounded-xl border border-slate-300 px-4 py-3 text-xl font-semibold tracking-widest outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Enter your PIN"
                />
                <button
                  type="submit"
                  disabled={submitting || !/^\d+$/.test(voterNumber) || !/^\d{12}$/.test(voterPin)}
                  className="mt-5 w-full rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60"
                >
                  {submitting ? "Checking…" : "Continue to ballot"}
                </button>
              </form>
            ) : reviewing ? (
              <section aria-labelledby="review-heading" className="mx-auto max-w-lg">
                <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">Final review</p>
                <h2 ref={reviewHeadingRef} id="review-heading" tabIndex={-1} className="mt-2 text-2xl font-bold focus:outline-none">
                  {reviewing === "candidate" ? "Confirm your selection" : "Confirm that you want to skip"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {reviewing === "candidate"
                    ? "Review the option below. Your vote is final once submitted."
                    : "Skipping will mark this ballot as skipped. No vote will be recorded."}
                </p>
                {reviewing === "candidate" && (
                  <div className="mt-5 flex items-center gap-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                    {selectedCandidate ? (
                      <>
                        <span aria-hidden="true" className="size-8 shrink-0 rounded-full border-2 border-white shadow ring-1 ring-slate-200" style={{ backgroundColor: selectedCandidate.color }} />
                        <span className="min-w-0">
                          <span className="block font-bold text-slate-900">{selectedCandidate.name}</span>
                          <span className="block text-sm text-slate-600">Symbol: {selectedCandidate.symbol_key}</span>
                        </span>
                      </>
                    ) : (
                      <span className="font-bold text-slate-900">NOTA <span className="font-normal text-slate-600">(None of the Above)</span></span>
                    )}
                  </div>
                )}
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => void submitVote(reviewing === "skip")}
                    disabled={submitting}
                    className={`min-h-12 flex-1 rounded-xl px-5 py-3 font-semibold text-white transition disabled:cursor-wait disabled:opacity-60 ${reviewing === "skip" ? "bg-rose-700 hover:bg-rose-800" : "bg-indigo-600 hover:bg-indigo-700"}`}
                  >
                    {submitting ? "Submitting…" : reviewing === "skip" ? "Confirm skip" : "Confirm and cast vote"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReviewing(null)}
                    disabled={submitting}
                    className="min-h-12 rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                  >
                    Back to ballot
                  </button>
                </div>
              </section>
            ) : (
              <div>
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-5">
                  <div>
                    <h2 ref={ballotHeadingRef} tabIndex={-1} className="text-xl font-bold focus:outline-none">Choose one option</h2>
                    <p className="mt-1 text-sm text-slate-600">Your choice cannot be changed after submission.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setVoterNumber("");
                      setVoterPin("");
                      setEligible(false);
                      setSelection(null);
                      setError("");
                    }}
                    disabled={submitting}
                    className="text-sm font-semibold text-indigo-700 hover:text-indigo-900 disabled:opacity-60"
                  >
                    Change voter number
                  </button>
                </div>

                <fieldset className="mt-6">
                  <legend className="sr-only">Select one candidate or NOTA</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {ballot?.candidates.map((candidate) => (
                      <label
                        key={candidate.id}
                        className={`cursor-pointer rounded-2xl border-2 p-5 transition focus-within:ring-2 focus-within:ring-indigo-200 ${
                          selection === candidate.id
                            ? "border-indigo-600 bg-indigo-50"
                            : "border-slate-200 bg-white hover:border-indigo-200"
                        }`}
                      >
                        <input
                          className="sr-only"
                          type="radio"
                          name="choice"
                          value={candidate.id}
                          checked={selection === candidate.id}
                          onChange={() => {
                            setSelection(candidate.id);
                            setReviewing(null);
                            setError("");
                          }}
                        />
                        <span className="flex items-start gap-3">
                          <span
                            aria-hidden="true"
                            className="mt-1 size-6 shrink-0 rounded-full border-2 border-white shadow ring-1 ring-slate-200"
                            style={{ backgroundColor: candidate.color }}
                          />
                          <span>
                            <span className="block text-lg font-bold">{candidate.name}</span>
                            <span className="mt-1 block text-sm text-slate-600">Symbol: {candidate.symbol_key}</span>
                            <span className="block text-xs text-slate-500">Color: {candidate.color}</span>
                          </span>
                        </span>
                      </label>
                    ))}

                    <label
                      className={`cursor-pointer rounded-2xl border-2 p-5 transition focus-within:ring-2 focus-within:ring-amber-200 ${
                        selection === "nota"
                          ? "border-amber-500 bg-amber-50"
                          : "border-amber-200 bg-amber-50/40 hover:border-amber-400"
                      }`}
                    >
                      <input
                        className="sr-only"
                        type="radio"
                        name="choice"
                        value="nota"
                        checked={selection === "nota"}
                        onChange={() => {
                          setSelection("nota");
                          setReviewing(null);
                          setError("");
                        }}
                      />
                      <span className="block text-lg font-bold">NOTA</span>
                      <span className="mt-1 block text-sm text-slate-600">None of the Above</span>
                    </label>
                  </div>
                </fieldset>

                <div className="mt-6 flex flex-col gap-3 border-t border-slate-100 pt-6 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => setReviewing("candidate")}
                    disabled={submitting || !selection}
                    className="min-h-12 flex-1 rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Review selection
                  </button>
                  <button
                    type="button"
                    onClick={() => setReviewing("skip")}
                    disabled={submitting}
                    className="min-h-12 rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                  >
                    Skip
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
