import "./globals.css";
import Providers from "./providers";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <title>lilikoi agency - the control room</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta
          name="description"
          content="One dashboard, every channel. AI-powered site audits, automated daily pacing reports, cross-channel attribution, and live campaign intel across Google, Meta, Microsoft, and organic - the control room for lilikoi agency's paid, organic, and data operations."
        />
        <link
          rel="icon"
          href="https://lilikoiagency.com/wp-content/uploads/2020/06/LIK-Logo-Icon-Favicon-No-Background.png"
          sizes="32x32"
        />
        {/* Runs before React hydrates - prevents theme flash on refresh */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('lik-theme');document.documentElement.dataset.theme=(t==='dark'||t==='light')?t:'light';}catch(e){}})();` }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
