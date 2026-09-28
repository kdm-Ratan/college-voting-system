"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setLoading(true);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError("We couldn't sign you in. Check your email and password, then try again.");
        setLoading(false);
        return;
      }

      router.push("/admin");
      router.refresh();
    } catch {
      setError("Unable to reach the sign-in service. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-[#f4f7fb] px-4 py-10 text-slate-900 sm:px-6">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-32 -top-40 size-[28rem] rounded-full bg-indigo-200/35 blur-3xl" />
        <div className="absolute -bottom-48 -right-32 size-[30rem] rounded-full bg-violet-200/30 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#64748b0a_1px,transparent_1px),linear-gradient(to_bottom,#64748b0a_1px,transparent_1px)] bg-[size:36px_36px]" />
      </div>

      <div className="w-full max-w-md">
        <header className="mb-7 text-center">
          <div aria-hidden="true" className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/20">
            <svg viewBox="0 0 24 24" fill="none" className="size-7" aria-hidden="true">
              <path d="M7 4.75h8.5L19 8.25v11H7a2 2 0 0 1-2-2v-10a2.5 2.5 0 0 1 2-2.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
              <path d="M15 4.75v4h4M8.5 13l2.1 2.1 4.9-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-indigo-700">Campus Ballot</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-[2rem]">Administrator Login</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">Securely manage your college election.</p>
        </header>

        <section className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-xl shadow-slate-900/[0.06] sm:p-8">
          <div className="mb-6 flex items-center gap-3 border-b border-slate-100 pb-5">
            <div aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-700">
              <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden="true">
                <path d="M6 10V7.5a6 6 0 0 1 12 0V10m-13 0h14v10H5V10Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M12 14v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h2 className="font-semibold text-slate-900">Sign in to your account</h2>
              <p className="mt-0.5 text-xs text-slate-500">Authorized election administrators only</p>
            </div>
          </div>

          {error && (
            <div role="alert" className="mb-5 flex gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-5 text-rose-800">
              <svg viewBox="0 0 20 20" fill="none" className="mt-0.5 size-5 shrink-0" aria-hidden="true">
                <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10 6.5v4m0 3h.01" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
              <p>{error}</p>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label htmlFor="admin-email" className="mb-2 block text-sm font-semibold text-slate-800">Email address</label>
              <div className="relative">
                <svg viewBox="0 0 24 24" fill="none" className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-slate-400" aria-hidden="true">
                  <path d="M4 6.5h16v11H4v-11Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                  <path d="m4.5 7 7.5 6 7.5-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <input
                  id="admin-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  placeholder="name@college.edu"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  disabled={loading}
                  className="block min-h-12 w-full rounded-xl border border-slate-300 bg-white py-3 pl-11 pr-4 text-base text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="admin-password" className="mb-2 block text-sm font-semibold text-slate-800">Password</label>
              <div className="relative">
                <svg viewBox="0 0 24 24" fill="none" className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-slate-400" aria-hidden="true">
                  <rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M8 10V7a4 4 0 1 1 8 0v3m-4 4v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <input
                  id="admin-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  disabled={loading}
                  className="block min-h-12 w-full rounded-xl border border-slate-300 bg-white py-3 pl-11 pr-16 text-base text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  disabled={loading}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-2 my-auto rounded-lg px-2.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white shadow-md shadow-indigo-600/15 transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-200 disabled:cursor-wait disabled:bg-indigo-400 disabled:shadow-none"
            >
              {loading && <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <div className="mt-6 border-t border-slate-100 pt-5 text-center">
            <Link href="/" className="text-sm font-semibold text-slate-600 underline-offset-4 hover:text-indigo-700 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:ring-offset-2">
              Back to Voting
            </Link>
          </div>
        </section>

        <footer className="mt-6 text-center text-xs text-slate-500">
          Campus Ballot <span aria-hidden="true">·</span> College Election System
        </footer>
      </div>
    </main>
  );
}
