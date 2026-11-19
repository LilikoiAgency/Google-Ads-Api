import localFont from "next/font/local";

// Geist (bundled with the app) for the whole audit report.
export const auditSans = localFont({
  src: "../../../fonts/GeistVF.woff",
  variable: "--audit-sans",
  weight: "100 900",
  display: "swap",
});
