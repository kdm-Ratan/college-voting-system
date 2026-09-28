"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ElectionStatus = "draft" | "ready" | "live" | "closed";
type EditableElectionStatus = "draft" | "ready";

async function getAdminClient() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Please sign in to manage elections.");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (error || profile?.role !== "admin") throw new Error("Administrator access is required.");

  return { supabase, user };
}

export async function createElection(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const totalVoters = Number(formData.get("total_voters"));
  if (title.length < 1 || title.length > 160) throw new Error("Enter an election title (up to 160 characters).");
  if (!Number.isSafeInteger(totalVoters) || totalVoters < 0 || totalVoters > 1000000) {
    throw new Error("Enter a voter total between 0 and 1,000,000.");
  }

  const { supabase, user } = await getAdminClient();
  const { error } = await supabase.from("elections").insert({
    title,
    total_voters: totalVoters,
    status: "draft",
    created_by: user.id,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

export async function updateElection(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const totalVoters = Number(formData.get("total_voters"));
  if (!id || title.length < 1 || title.length > 160) throw new Error("Enter a valid election title.");
  if (!Number.isSafeInteger(totalVoters) || totalVoters < 0 || totalVoters > 1000000) {
    throw new Error("Enter a voter total between 0 and 1,000,000.");
  }

  const { supabase } = await getAdminClient();
  const { data: election, error: readError } = await supabase
    .from("elections").select("status, total_voters").eq("id", id).single();
  if (readError || !election) throw new Error("Election could not be found.");
  if (election.status === "live" || election.status === "closed") {
    throw new Error("Election details cannot be edited after the election is live or closed.");
  }

  const { error } = await supabase.from("elections")
    .update({ title, total_voters: totalVoters }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

export async function changeElectionStatus(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const next = String(formData.get("status") ?? "") as ElectionStatus;
  if (!id || !["draft", "ready", "live", "closed"].includes(next)) throw new Error("Invalid election status change.");

  const { supabase } = await getAdminClient();
  const { data: election, error: readError } = await supabase
    .from("elections").select("status, total_voters").eq("id", id).single();
  if (readError || !election) throw new Error("Election could not be found.");

  const allowed: Record<ElectionStatus, ElectionStatus[]> = {
    draft: ["ready"], ready: ["draft", "live"], live: ["closed"], closed: [],
  };
  if (!allowed[election.status as ElectionStatus]?.includes(next)) {
    throw new Error("That status change is not allowed.");
  }
  if (next === "live" && election.total_voters < 1) {
    throw new Error("Configure at least one voter before starting the election.");
  }

  const { error } = await supabase.from("elections").update({ status: next }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

function getCandidateValues(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const symbolKey = String(formData.get("symbol_key") ?? "").trim();
  const color = String(formData.get("color") ?? "").trim();
  const displayOrder = Number(formData.get("display_order"));

  if (!name) throw new Error("Enter a candidate name.");
  if (!symbolKey) throw new Error("Enter an election symbol.");
  if (!color) throw new Error("Choose a candidate color.");
  if (!Number.isSafeInteger(displayOrder) || displayOrder < 0) {
    throw new Error("Display order must be a whole number starting at 0.");
  }

  return {
    name,
    symbol_key: symbolKey,
    color,
    display_order: displayOrder,
    is_active: formData.get("is_active") === "on",
  };
}

async function getEditableElection(electionId: string) {
  if (!electionId) throw new Error("Choose a valid election.");

  const { supabase, user } = await getAdminClient();
  const { data: election, error } = await supabase
    .from("elections")
    .select("id, status, total_voters")
    .eq("id", electionId)
    .single();
  if (error || !election) throw new Error("Election could not be found.");
  if (!( ["draft", "ready"] as EditableElectionStatus[]).includes(election.status as EditableElectionStatus)) {
    throw new Error("Candidates can only be managed while the election is Draft or Ready.");
  }

  return { supabase, user, election };
}

async function ensureCandidateOrderIsAvailable(
  supabase: Awaited<ReturnType<typeof createClient>>,
  electionId: string,
  displayOrder: number,
  candidateId?: string
) {
  const { data: candidates, error } = await supabase
    .from("candidates")
    .select("id")
    .eq("election_id", electionId)
    .eq("display_order", displayOrder);
  if (error) throw new Error(error.message);
  if (candidates?.some((candidate) => candidate.id !== candidateId)) {
    throw new Error("That display order is already used by another candidate.");
  }
}

export async function createCandidate(formData: FormData) {
  const electionId = String(formData.get("election_id") ?? "");
  const values = getCandidateValues(formData);
  const { supabase, election } = await getEditableElection(electionId);

  const { data: existing, error: duplicateError } = await supabase
    .from("candidates")
    .select("id")
    .eq("election_id", election.id)
    .eq("name", values.name)
    .limit(1);
  if (duplicateError) throw new Error(duplicateError.message);
  if (existing && existing.length > 0) throw new Error("A candidate with that name already exists for this election.");

  await ensureCandidateOrderIsAvailable(supabase, election.id, values.display_order);
  const { error } = await supabase.from("candidates").insert({
    election_id: election.id,
    ...values,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

export async function updateCandidate(formData: FormData) {
  const candidateId = String(formData.get("candidate_id") ?? "");
  const electionId = String(formData.get("election_id") ?? "");
  if (!candidateId) throw new Error("Candidate could not be found.");

  const values = getCandidateValues(formData);
  const { supabase, election } = await getEditableElection(electionId);
  const { data: candidate, error: candidateError } = await supabase
    .from("candidates")
    .select("id, election_id")
    .eq("id", candidateId)
    .single();
  if (candidateError || !candidate || candidate.election_id !== election.id) {
    throw new Error("Candidate does not belong to this election.");
  }

  const { data: existing, error: duplicateError } = await supabase
    .from("candidates")
    .select("id")
    .eq("election_id", election.id)
    .eq("name", values.name);
  if (duplicateError) throw new Error(duplicateError.message);
  if (existing?.some((item) => item.id !== candidateId)) {
    throw new Error("A candidate with that name already exists for this election.");
  }

  await ensureCandidateOrderIsAvailable(supabase, election.id, values.display_order, candidateId);
  const { error } = await supabase.from("candidates").update(values).eq("id", candidateId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

export async function deleteCandidate(formData: FormData) {
  const candidateId = String(formData.get("candidate_id") ?? "");
  const electionId = String(formData.get("election_id") ?? "");
  if (!candidateId) throw new Error("Candidate could not be found.");

  const { supabase, election } = await getEditableElection(electionId);
  const { data: candidate, error: candidateError } = await supabase
    .from("candidates")
    .select("id, election_id")
    .eq("id", candidateId)
    .single();
  if (candidateError || !candidate || candidate.election_id !== election.id) {
    throw new Error("Candidate does not belong to this election.");
  }

  const { error } = await supabase.from("candidates").delete().eq("id", candidateId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

export async function generateVoters(formData: FormData) {
  const electionId = String(formData.get("election_id") ?? "");
  const { supabase, election } = await getEditableElection(electionId);
  if (election.total_voters < 1) {
    throw new Error("Configure at least one voter before generating the roster.");
  }

  const { error } = await supabase.rpc("generate_election_voters", {
    p_election_id: election.id,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

export async function createVoter(formData: FormData) {
  const electionId = String(formData.get("election_id") ?? "");
  const voterNumber = Number(formData.get("voter_number"));
  if (!Number.isSafeInteger(voterNumber) || voterNumber < 1) {
    throw new Error("Voter number must be a positive whole number.");
  }

  const { supabase, election } = await getEditableElection(electionId);
  if (voterNumber > election.total_voters) {
    throw new Error(`Voter number must be between 1 and ${election.total_voters}.`);
  }

  const { error } = await supabase.from("voters").insert({
    election_id: election.id,
    voter_number: voterNumber,
  });
  if (error) {
    if (error.code === "23505") throw new Error("That voter number is already configured for this election.");
    throw new Error(error.message);
  }
  revalidatePath("/admin");
}

export async function issueVoterPin(electionId: string, voterId: string): Promise<string> {
  if (!electionId || !voterId) throw new Error("Choose a valid voter.");

  const { supabase } = await getAdminClient();
  const { data, error } = await supabase.rpc("issue_voter_pin", {
    p_election_id: electionId,
    p_voter_id: voterId,
  });
  if (error) throw new Error("The voter PIN could not be issued. Please try again.");
  if (typeof data !== "string" || !/^\d{12}$/.test(data)) {
    throw new Error("The voter PIN service returned an invalid response.");
  }

  revalidatePath("/admin");
  return data;
}

export async function markVoterUnavailable(formData: FormData) {
  const electionId = String(formData.get("election_id") ?? "");
  const voterId = String(formData.get("voter_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!voterId || !["skipped", "absent"].includes(status)) {
    throw new Error("Choose a valid voter status.");
  }
  if (!electionId) throw new Error("Choose a valid election.");

  const { supabase, user } = await getAdminClient();
  const { data: election, error: electionError } = await supabase
    .from("elections")
    .select("id, status")
    .eq("id", electionId)
    .single();
  if (electionError || !election) throw new Error("Election could not be found.");

  const isEditableElection = election.status === "draft" || election.status === "ready";
  const isLiveAbsence = election.status === "live" && status === "absent";
  if (!isEditableElection && !isLiveAbsence) {
    throw new Error("Voters can only be marked unavailable while the election is Draft, Ready, or marked absent during Live voting.");
  }

  const { data: voter, error: voterError } = await supabase
    .from("voters")
    .select("id, election_id, status")
    .eq("id", voterId)
    .single();
  if (voterError || !voter || voter.election_id !== election.id) {
    throw new Error("Voter does not belong to this election.");
  }
  if (voter.status !== "pending") {
    throw new Error("Only pending voters can be marked skipped or absent.");
  }

  const { data: updatedVoter, error } = await supabase
    .from("voters")
    .update({
      status,
      status_changed_at: new Date().toISOString(),
      status_changed_by: user.id,
    })
    .eq("id", voter.id)
    .eq("election_id", election.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updatedVoter) throw new Error("This voter is no longer pending and could not be marked unavailable.");
  revalidatePath("/admin");
}
