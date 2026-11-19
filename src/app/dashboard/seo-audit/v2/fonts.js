import { Newsreader, Public_Sans } from "next/font/google";

// Audit report typefaces: an editorial serif for the headline, scores and move
// numbers; a plain public-sector sans for everything you read and click.
export const auditSerif = Newsreader({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--audit-serif", display: "swap", adjustFontFallback: false });
export const auditSans = Public_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--audit-sans", display: "swap" });
