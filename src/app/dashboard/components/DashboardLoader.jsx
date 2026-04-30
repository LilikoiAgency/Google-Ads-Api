// src/app/dashboard/components/DashboardLoader.jsx
"use client";

export default function DashboardLoader({ label = "Loading...", steps = [] }) {
  const visibleSteps = steps.slice(0, 4);

  return (
    <>
      <style>{`
        @keyframes dash-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes dash-pulse {
          0%, 100% { opacity: 0.45; transform: scale(0.92); }
          50% { opacity: 1; transform: scale(1); }
        }
        @keyframes dash-sweep {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(120%); }
        }
        @keyframes dash-step {
          0%, 100% { opacity: 0.48; }
          35%, 65% { opacity: 1; }
        }
      `}</style>
      <div
        role="status"
        aria-live="polite"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          gap: 18,
          minHeight: 240,
          padding: 24,
        }}
      >
        <div style={{ position: "relative", width: 86, height: 86 }}>
          <svg width="86" height="86" viewBox="0 0 86 86" style={{ overflow: "visible" }} aria-hidden="true">
            <defs>
              <linearGradient id="dash-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#4285F4" />
                <stop offset="36%" stopColor="#34A853" />
                <stop offset="68%" stopColor="#FBBC05" />
                <stop offset="100%" stopColor="#EA4335" />
              </linearGradient>
              <filter id="dash-soft-glow" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <circle
              cx="43"
              cy="43"
              r="34"
              fill="none"
              stroke="rgba(148,163,184,0.2)"
              strokeWidth="3"
            />
            <circle
              cx="43"
              cy="43"
              r="34"
              fill="none"
              stroke="url(#dash-ring-grad)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray="214"
              strokeDashoffset="150"
              filter="url(#dash-soft-glow)"
              style={{
                transformOrigin: "43px 43px",
                animation: "dash-spin 1s linear infinite",
              }}
            />
          </svg>

          <div
            style={{
              position: "absolute",
              inset: 18,
              borderRadius: 18,
              background: "var(--loader-panel-bg)",
              border: "1px solid var(--loader-panel-border)",
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 5,
              padding: 10,
            }}
            aria-hidden="true"
          >
            {["#4285F4", "#34A853", "#FBBC05", "#EA4335"].map((color, index) => (
              <span
                key={color}
                style={{
                  borderRadius: 6,
                  background: color,
                  animation: `dash-pulse 1.3s ease-in-out ${index * 0.16}s infinite`,
                }}
              />
            ))}
          </div>
        </div>

        {label && (
          <div
            style={{
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              alignItems: "center",
            }}
          >
            <p
              style={{
                fontSize: 14,
                color: "var(--loader-text)",
                margin: 0,
                fontWeight: 700,
                letterSpacing: "0.2px",
              }}
            >
              {label}
            </p>
            <div
              style={{
                width: 220,
                height: 4,
                borderRadius: 999,
                background: "var(--loader-track)",
                overflow: "hidden",
              }}
              aria-hidden="true"
            >
              <div
                style={{
                  width: "70%",
                  height: "100%",
                  borderRadius: 999,
                  background: "linear-gradient(90deg, transparent, var(--loader-shimmer), transparent)",
                  animation: "dash-sweep 1.35s ease-in-out infinite",
                }}
              />
            </div>
          </div>
        )}

        {visibleSteps.length > 0 && (
          <div
            style={{
              display: "grid",
              gap: 8,
              width: "min(320px, 100%)",
            }}
          >
            {visibleSteps.map((step, index) => (
              <div
                key={step}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  minHeight: 32,
                  borderRadius: 8,
                  border: "1px solid var(--loader-step-border)",
                  background: "var(--loader-step-bg)",
                  padding: "7px 10px",
                  color: "var(--loader-step-text)",
                  fontSize: 12,
                  fontWeight: 600,
                  animation: `dash-step 2.4s ease-in-out ${index * 0.35}s infinite`,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 999,
                    background: ["#4285F4", "#34A853", "#FBBC05", "#EA4335"][index % 4],
                    flexShrink: 0,
                  }}
                />
                <span>{step}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
