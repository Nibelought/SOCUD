import type { Metadata, Viewport } from "next";
import { Source_Serif_4 } from "next/font/google";
import "./globals.css";
import AuthSync from "@/components/auth/AuthSync";

// Reading face for document content. UI text uses the system face (see globals.css).
// Latin and Cyrillic: documents are written in English and Russian.
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin", "cyrillic"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "SOCUD", template: "%s – SOCUD" },
  description: "SOCUD is a collaborative knowledge base: spaces, real-time document editing, semantic search and a knowledge graph.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1c1e" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={sourceSerif.variable}>
      <body>
        <AuthSync />
        {children}
      </body>
    </html>
  );
}
