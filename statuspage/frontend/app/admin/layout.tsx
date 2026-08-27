import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Operations",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

export default function OperationsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
