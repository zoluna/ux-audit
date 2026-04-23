import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Parallel UX Audit",
  description:
    "Upload a product screenshot and orchestrate five AI specialists to audit hierarchy, copy, accessibility, mobile readiness, and conversion.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
