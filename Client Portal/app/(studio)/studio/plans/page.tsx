import Link from "next/link";
import { getPlans } from "@/lib/data/plans";
import { PlansEditor } from "@/components/studio/PlansEditor";

export const dynamic = "force-dynamic";

export default async function StudioPlansPage() {
  const plans = await getPlans({ all: true });
  const live = plans.filter((p) => p.published).length;
  return (
    <>
      <div className="mb-8">
        <p className="label mb-2">Studio · Plans</p>
        <h1 className="font-display text-3xl sm:text-4xl leading-none">{live} plan{live === 1 ? "" : "s"} live.</h1>
        <p className="mt-2 text-sm text-ink-muted max-w-2xl">
          What clients see on their <Link className="underline" href="/plans">Plans</Link> page and on the SEO Autopilot paywall. The plan builder is priced from these rows: the &quot;posts&quot; row sets the per-post rate, each add-on row is a flat monthly amount, and clients pay the exact combination on Square.
          Rows that aren&apos;t in the builder show with &quot;I&apos;m interested&quot; (lands in your Inbox; start it from <Link className="underline" href="/studio/billing">Billing</Link> once priced). Drafts stay hidden until you publish them.
        </p>
      </div>
      <PlansEditor plans={plans} />
    </>
  );
}
