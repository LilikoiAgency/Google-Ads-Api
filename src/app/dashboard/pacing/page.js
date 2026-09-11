"use client";
export const dynamic = 'force-dynamic';
import PacingReportsView from "../components/PacingReportsView";

export default function PacingDashboardPage() {
  return (
    <PacingReportsView
      apiBase="/api/pacing"
      title="Daily Pacing Reports"
      subtitle="Paid Search & Social. Automated Mon–Fri at 9 AM ET. Edit recipients and sheet IDs here."
      sheetMode="perClient"
    />
  );
}
