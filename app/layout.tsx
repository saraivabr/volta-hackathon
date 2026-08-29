import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Volta — Verified logistics commitments",
  description: "Delegated logistics operations with auditable authority.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

