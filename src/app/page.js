import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { SignInButton } from "./components/AuthActions";
import { authOptions, allowedEmailDomain } from "../lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }) {
  const session = await getServerSession(authOptions);
  const callbackUrl =
    typeof searchParams?.callbackUrl === "string" && searchParams.callbackUrl.startsWith("/")
      ? searchParams.callbackUrl
      : "/dashboard";

  if (session?.user?.email?.toLowerCase().endsWith(`@${allowedEmailDomain}`)) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#0f172a_0%,#111827_40%,#020617_100%)] text-white">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-8 lg:px-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img
              alt="Lilikoi Agency"
              className="h-12 w-12 rounded-2xl bg-white/10 p-2 ring-1 ring-white/15"
              src="https://lilikoiagency.com/wp-content/uploads/2020/05/LIK-Logo-Icon-Favicon.png"
            />
            <div>
              <p className="text-xs uppercase tracking-[0.36em] text-white/45">
                Lilikoi Agency
              </p>
              <p className="mt-1 text-sm text-white/68">
                Google Ads reporting access
              </p>
            </div>
          </div>

          <div className="hidden rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium uppercase tracking-[0.26em] text-white/55 md:block">
            Google SSO only
          </div>
        </header>

        <div className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1.12fr_0.88fr]">
          <section className="max-w-3xl">
            <p className="inline-flex rounded-full border border-sky-400/20 bg-sky-400/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.3em] text-sky-200">
              Internal dashboard
            </p>

            <h1 className="mt-8 text-5xl font-semibold leading-[1.02] tracking-tight text-white md:text-6xl">
              Secure access for the
              <span className="block text-white/68">Lilikoi paid search team.</span>
            </h1>

            <p className="mt-8 max-w-2xl text-lg leading-8 text-slate-300">
              Review campaign performance, search terms, landing pages, device
              trends, impression share, and optimization insights in one internal
              workspace protected by Google single sign-on.
            </p>

            <div className="mt-10 grid gap-4 md:grid-cols-3">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.24em] text-white/45">
                  Reporting
                </p>
                <p className="mt-3 text-lg font-medium">Cross-account visibility</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Search terms, landing pages, devices, trends, and impression share in one view.
                </p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.24em] text-white/45">
                  Access
                </p>
                <p className="mt-3 text-lg font-medium">Google-only SSO</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Access is limited to approved company identities on the Lilikoi domain.
                </p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.24em] text-white/45">
                  Workflow
                </p>
                <p className="mt-3 text-lg font-medium">Built for optimization</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Surface where spend, conversion volume, and delivery constraints need action.
                </p>
              </div>
            </div>
          </section>

          <section className="relative">
            <div className="rounded-[2rem] border border-white/10 bg-white p-8 text-slate-900 shadow-[0_30px_90px_rgba(2,6,23,0.4)] xl:p-10">
              <div className="flex items-center justify-between">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg shadow-slate-900/20">
                  <svg
                    aria-hidden="true"
                    className="h-7 w-7"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M7 10V8a5 5 0 1 1 10 0v2m-9 0h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.7"
                    />
                  </svg>
                </div>
                <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">
                  SSO required
                </div>
              </div>

              <div className="mt-8">
                <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-400">
                  Sign in
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                  Continue with Google
                </h2>
                <p className="mt-4 text-sm leading-7 text-slate-600">
                  Use your company Google identity to enter the internal Google Ads dashboard.
                  Password login is disabled.
                </p>
              </div>

              <div className="mt-8 rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sm font-semibold text-sky-700">
                    ID
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Restricted company access
                    </p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      Only <span className="font-semibold text-slate-900">@{allowedEmailDomain}</span> accounts can sign in.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-8">
                <SignInButton callbackUrl={callbackUrl} />
              </div>

              <div className="mt-6 rounded-2xl bg-slate-950 px-4 py-4 text-sm text-slate-200">
                <p className="font-medium text-white">Need access?</p>
                <p className="mt-1 leading-6 text-slate-300">
                  Contact the Lilikoi Agency admin team if your company Google account
                  should be added to this dashboard.
                </p>
              </div>

              <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-6 text-xs uppercase tracking-[0.24em] text-slate-400">
                <span>Google-only authentication</span>
                <span>&copy; 2026 Lilikoi Agency</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
