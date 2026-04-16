// src/app/dashboard/components/DashboardLoader.jsx
"use client";

/**
 * Full-content-area loading state — gradient ring spinner.
 * Drop-in replacement for the old GIF loader.
 *
 * Usage:
 *   <DashboardLoader label="Pulling data from Google..." />
 *
 * Fills flex-1 and centers itself — works inside any flex-column container.
 */
export default function DashboardLoader({ label = "Loading..." }) {
  return (
    <>
      <style>{`
        @keyframes dash-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          gap: 16,
          minHeight: 240,
        }}
      >
        <svg
          width="52"
          height="52"
          viewBox="0 0 52 52"
          style={{ overflow: "visible" }}
        >
          <defs>
            <linearGradient id="dash-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#a855f7" />
              <stop offset="100%" stopColor="#6366f1" />
            </linearGradient>
          </defs>

          {/* Faint track */}
          <circle
            cx="26" cy="26" r="22"
            fill="none"
            stroke="rgba(168,85,247,0.15)"
            strokeWidth="3"
          />

          {/* Spinning gradient arc */}
          <circle
            cx="26" cy="26" r="22"
            fill="none"
            stroke="url(#dash-ring-grad)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="138"
            strokeDashoffset="104"
            style={{
              transformOrigin: "26px 26px",
              animation: "dash-spin 0.9s linear infinite",
            }}
          />
        </svg>

        {label && (
          <p
            style={{
              fontSize: 13,
              color: "rgba(255,255,255,0.35)",
              margin: 0,
              letterSpacing: "0.3px",
            }}
          >
            {label}
          </p>
        )}
      </div>
    </>
  );
}
