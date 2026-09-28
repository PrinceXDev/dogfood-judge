import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { PointerGlow } from "@/components/motion";
import { CommandProvider } from "@/components/shell/command-palette";
import { Footer } from "@/components/shell/footer";
import { SiteNav } from "@/components/shell/site-nav";
import { getNav } from "@/lib/nav";
import { PREFS_SCRIPT } from "@/lib/prefs";
import "./globals.css";

// Fonts are downloaded at build time and served from this origin, so the
// running portal makes no third-party requests (offline-first).
const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument",
});

export const metadata: Metadata = {
  title: { default: "Dogfood Judge", template: "%s · Dogfood Judge" },
  description:
    "Judge the work. Prove the result. Open-source infrastructure for hackathon submissions, judging, normalization and verifiable results.",
  applicationName: "Dogfood Judge",
};

export const viewport: Viewport = {
  themeColor: "#060808",
  colorScheme: "dark light",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const nav = await getNav();
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${geist.variable} ${mono.variable} ${serif.variable}`}
    >
      <head>
        {/* Applies the saved theme and motion preference before first paint. */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant script from lib/prefs, no user input */}
        <script dangerouslySetInnerHTML={{ __html: PREFS_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col font-sans antialiased">
        <CommandProvider nav={nav}>
          <SiteNav nav={nav} />
          <main id="main" className="flex-1">
            {children}
          </main>
          <Footer />
          <PointerGlow />
        </CommandProvider>
      </body>
    </html>
  );
}
