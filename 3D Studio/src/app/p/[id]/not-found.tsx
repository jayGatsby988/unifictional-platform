import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="panel max-w-md p-8 text-center">
        <p className="eyebrow">404</p>
        <h1 className="font-display mt-3 text-3xl">This project link has expired</h1>
        <p className="mt-3 text-sm text-muted">
          Shared projects are removed when the contractor deletes them. Ask for a fresh link, or build your own twin.
        </p>
        <Link href="/studio" className="btn btn-primary mt-6">Open the studio</Link>
      </div>
    </main>
  );
}
