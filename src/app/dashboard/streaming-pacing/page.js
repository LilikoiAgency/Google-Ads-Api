"use client";
export const dynamic = 'force-dynamic';
import PacingReportsView from "../components/PacingReportsView";

export default function StreamingPacingDashboardPage() {
  return (
    <PacingReportsView
      apiBase="/api/streaming-pacing"
      title="Targeted Streaming Pacing"
      subtitle="CTV, audio and DOOH vendors from the shared Targeted Streaming Spends sheet. Automated Mon–Fri, five minutes after the Paid Search report."
      sheetMode="shared"
    />
  );
}
