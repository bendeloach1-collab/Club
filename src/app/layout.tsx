import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Athens Athletic Club", template: "%s · Athens Athletic Club" },
  description: "Membership, training, classes and club services at Athens Athletic Club.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#111e31" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
