"use client";

import { signIn, signOut, useSession } from "next-auth/react";

export function SignInButton({ callbackUrl = "/dashboard" }) {
  const { status } = useSession();

  return (
    <button
      className="inline-flex w-full items-center justify-center gap-3 rounded-2xl bg-slate-900 px-5 py-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
      disabled={status === "loading"}
      onClick={() => signIn("google", { callbackUrl })}
      type="button"
    >
      <svg
        aria-hidden="true"
        className="h-5 w-5"
        viewBox="0 0 24 24"
      >
        <path
          d="M21.8 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.5a4.7 4.7 0 0 1-2 3.1v2.6h3.2c1.9-1.8 3.1-4.4 3.1-7.5Z"
          fill="#4285F4"
        />
        <path
          d="M12 22c2.7 0 4.9-.9 6.5-2.3l-3.2-2.6c-.9.6-2 .9-3.3.9-2.5 0-4.7-1.7-5.5-4.1H3.2v2.7A10 10 0 0 0 12 22Z"
          fill="#34A853"
        />
        <path
          d="M6.5 13.9a6 6 0 0 1 0-3.8V7.4H3.2a10 10 0 0 0 0 9.1l3.3-2.6Z"
          fill="#FBBC04"
        />
        <path
          d="M12 6a5.4 5.4 0 0 1 3.8 1.5l2.8-2.8A9.6 9.6 0 0 0 12 2 10 10 0 0 0 3.2 7.4l3.3 2.6C7.3 7.7 9.5 6 12 6Z"
          fill="#EA4335"
        />
      </svg>
      {status === "loading" ? "Checking session..." : "Sign in with Google"}
    </button>
  );
}

export function SignOutButton() {
  return (
    <button
      className="rounded-lg border border-white/20 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10"
      onClick={() => signOut({ callbackUrl: "/" })}
      type="button"
    >
      Sign out
    </button>
  );
}
