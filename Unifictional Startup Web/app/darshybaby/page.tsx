import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "darshybaby",
  robots: { index: false, follow: false },
};

export default function DarshyBabyPage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <span role="img" aria-label="poop" className="text-[40vmin] leading-none">
        💩
      </span>
    </main>
  );
}
