import type { Metadata } from "next";
import "./globals.css";
import "./workshop.css";
export const metadata: Metadata = {
  title: "m8itwork — Take your AI-built app further.",
  description:
    "Finish, fix, and extend the app you started with AI. Get help with launch, custom features, integrations, and verified workflows.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
