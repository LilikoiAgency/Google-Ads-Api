"use client";

import Link from "next/link";
import { SignOutButton } from "../../components/AuthActions";

export default function Sidebar({
  currentCustomerName,
  campaigns,
  selectedCampaign,
  handleCampaignSelect,
  onClearCampaign,
  campaignStatusFilter,
  campaignStatusOptions,
  onCampaignStatusFilterChange,
  lastUpdated,
  refreshData,
  closeSidebar,
}) {
  const sortedCampaigns = (campaigns || [])
    .slice()
    .sort((a, b) => (b.conversions || 0) - (a.conversions || 0));

  return (
    <div className="flex h-auto w-full flex-col bg-customPurple-dark p-5 shadow-lg sm:h-screen sm:w-80">

      {/* Close button (mobile only) */}
      <div className="mb-3 flex items-center justify-end sm:hidden">
        <button
          className="rounded-lg border border-white/20 px-3 py-2 text-sm font-medium text-white hover:bg-white/10"
          onClick={closeSidebar}
          type="button"
        >
          Close
        </button>
      </div>

      {/* Current account label */}
      <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-1">Account</p>
        <p className="text-sm font-semibold text-white truncate">{currentCustomerName || "—"}</p>
      </div>

      {/* Status filter */}
      <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 p-4">
        <label className="block text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-2">
          Campaign Status
        </label>
        <div className="relative">
          <select
            className="w-full appearance-none rounded-xl border border-white/10 bg-white/10 px-4 py-2.5 pr-10 text-sm font-semibold text-white outline-none transition hover:bg-white/15 focus:border-white/30"
            onChange={(e) => onCampaignStatusFilterChange(e.target.value)}
            value={campaignStatusFilter}
          >
            {campaignStatusOptions.map((opt) => (
              <option key={opt.value} value={opt.value} className="text-slate-900">{opt.label}</option>
            ))}
          </select>
          <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"/>
          </svg>
        </div>
      </div>

      {/* Campaign list */}
      <div className="sidebar-scrollbar flex-1 overflow-y-auto">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-2 px-1">
          Campaigns ({sortedCampaigns.length})
        </p>
        {sortedCampaigns.length === 0 ? (
          <div className="rounded-xl bg-white/5 p-4 text-sm text-gray-400 text-center">
            No campaigns found.
          </div>
        ) : (
          <ul className="space-y-1">
            {/* All Campaigns — account overview */}
            <li>
              <button
                onClick={onClearCampaign}
                className={`w-full rounded-xl px-3 py-2.5 text-left transition flex items-center gap-2 ${
                  !selectedCampaign
                    ? "bg-white/20 text-white"
                    : "text-gray-400 hover:bg-white/10 hover:text-white"
                }`}
              >
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                  <path d="M4 6h16M4 10h16M4 14h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <span className="text-sm font-semibold">All Campaigns</span>
              </button>
            </li>

            {sortedCampaigns.map((campaign, index) => {
              const isSelected = selectedCampaign?.campaignId === campaign.campaignId;
              return (
                <li key={campaign.campaignId}>
                  <button
                    id={`campaign-${campaign.campaignId}`}
                    onClick={() => handleCampaignSelect(campaign.campaignId)}
                    className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
                      isSelected
                        ? "bg-white/20 text-white"
                        : "text-gray-400 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-gray-500 w-5 flex-shrink-0">#{index + 1}</span>
                      <span className="text-sm font-medium truncate">{campaign.campaignName}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Bottom nav */}
      <div className="mt-4 border-t border-white/10 pt-4 space-y-2">
        <Link href="/dashboard"
          className="flex w-full items-center gap-2.5 rounded-xl bg-white/5 px-4 py-2.5 text-sm font-medium text-gray-300 transition hover:bg-white/10 hover:text-white">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M9 22V12h6v10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Home
        </Link>
        <Link href="/report"
          className="flex w-full items-center gap-2.5 rounded-xl bg-white/5 px-4 py-2.5 text-sm font-medium text-gray-300 transition hover:bg-white/10 hover:text-white">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Paid vs. Organic Report
        </Link>
        <Link href="/dashboard/streaming"
          className="flex w-full items-center gap-2.5 rounded-xl bg-white/5 px-4 py-2.5 text-sm font-medium text-gray-300 transition hover:bg-white/10 hover:text-white">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="13" rx="2"/><path d="M16 2l-4 5-4-5"/></svg>
          Targeted Streaming
        </Link>

        <div className="px-1 pt-1">
          <p className="text-xs text-gray-500">Last updated</p>
          <p className="text-xs text-gray-400 mt-0.5">{lastUpdated || "Not synced yet"}</p>
        </div>

        <button onClick={refreshData}
          className="w-full rounded-xl bg-blue-700 hover:bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition">
          Refresh Data
        </button>

        <div className="pt-1">
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
