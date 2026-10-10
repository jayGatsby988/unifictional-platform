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
          What clients see on their <Link className="underline" href="/plans">Plans</Link> page. Drafts stay hidden until you publish them. Leave the price blank to show &quot;Custom&quot;.
          When a client taps &quot;I&apos;m interested&quot; it lands in your Inbox; once you&apos;ve agreed a price, start it from <Link className="underline" href="/studio/billing">Billing</Link>.
        </p>
      </div>
      <PlansEditor plans={plans} />
    </>
  );
}
