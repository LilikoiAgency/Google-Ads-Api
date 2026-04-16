// src/app/dashboard/components/DashboardIcons.jsx
// Single source of truth for all dashboard nav/header icons.
// Import from here in both DashboardSidebar and individual page headers.
"use client";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faFileLines, faMagnifyingGlassChart,
  faBriefcase, faPeopleGroup, faTv, faChartLine,
} from "@fortawesome/free-solid-svg-icons";
import { faMeta, faSquareWindows } from "@fortawesome/free-brands-svg-icons";

const S = 16; // standard icon size

export function GoogleAdsIcon() {
  return (
    <svg viewBox="0 0 48 48" width={S} height={S}>
      <path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

export function MetaAdsIcon() {
  return <FontAwesomeIcon icon={faMeta} style={{ width: S, height: S, color: "#1877F2" }} />;
}

export function MicrosoftAdsIcon() {
  return (
    <svg width={S} height={S} viewBox="0 0 21 21">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" rx="1"/>
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" rx="1"/>
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" rx="1"/>
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" rx="1"/>
    </svg>
  );
}

export function SearchConsoleIcon() {
  return (
    <svg viewBox="0 0 64 64" width={S} height={S}>
      <circle cx="26" cy="26" r="18" fill="none" stroke="#4285F4" strokeWidth="6"/>
      <circle cx="26" cy="26" r="9" fill="#34A853"/>
      <line x1="39" y1="39" x2="57" y2="57" stroke="#EA4335" strokeWidth="6" strokeLinecap="round"/>
      <circle cx="26" cy="26" r="4" fill="#FBBC04"/>
    </svg>
  );
}

export function ReportIcon() {
  return <FontAwesomeIcon icon={faFileLines} style={{ width: S, height: S, color: "#f59e0b" }} />;
}

export function SEOAuditIcon() {
  return <FontAwesomeIcon icon={faMagnifyingGlassChart} style={{ width: S, height: S, color: "#0d9488" }} />;
}

export function ClientPortalsIcon() {
  return <FontAwesomeIcon icon={faBriefcase} style={{ width: S, height: S, color: "#a855f7" }} />;
}

export function AudienceLabIcon() {
  return <FontAwesomeIcon icon={faPeopleGroup} style={{ width: S, height: S, color: "#4285F4" }} />;
}

export function StreamingIcon() {
  return <FontAwesomeIcon icon={faTv} style={{ width: S, height: S, color: "#0ea5e9" }} />;
}

export function UsageAnalyticsIcon() {
  return <FontAwesomeIcon icon={faChartLine} style={{ width: S, height: S, color: "#ec4899" }} />;
}
