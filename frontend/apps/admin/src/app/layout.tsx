import type { Metadata } from "next";
import "@m8itwork/ui/styles/globals.css";
import "@m8itwork/ui/styles/workshop.css";
import "@m8itwork/ui/styles/fields.css";
export const metadata: Metadata = {
  title: "Backoffice — m8itwork",
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
