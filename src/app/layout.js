// src/app/layout.js
export default function RootLayout({ children }) {
    return (
      <html lang="en">
        <head>
          <title>Lik: Google Ads Dashboard</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta name="description" content="Lik: Google Ads Dashboard for managing campaigns and analyzing data." />
          <link
            rel="icon"
            href="https://lilikoiagency.com/wp-content/uploads/2020/06/LIK-Logo-Icon-Favicon-No-Background.png"
            sizes="32x32"
          />
        </head>
        <body>
          <header>
            {/* Add any navigation or header content here */}
          </header>
          <main>{children}</main>
          <footer>
            <p className="text-center p-5">&copy; 2024 Lilikoi Agency</p>
          </footer>
        </body>
      </html>
    );
  }
  