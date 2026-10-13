import { test } from "node:test";
import assert from "node:assert/strict";
import { requestReplyEmail, studioNewRequestEmail, postNeedsOkEmail, monthlyReportEmail } from "../lib/email/templates.ts";

test("request reply email carries the answer itself and escapes it", () => {
  const m = requestReplyEmail({ name: "Dave", title: "Swap the hero <photo>", reply: "Done! New photo is up.\n<script>x</script>", done: true, portalUrl: "https://p/login" });
  assert.match(m.subject, /^Re: Swap the hero/);
  assert.match(m.html, /New photo is up/);
  assert.ok(!m.html.includes("<script>x"), "reply text is escaped");
  assert.match(m.html, /marked this one <b>done<\/b>/);
});

test("studio hears about new requests with a link to the item", () => {
  const m = studioNewRequestEmail({ company: "Blue Lake", email: "o@bl.com", type: "website", title: "New phone number", body: "It's 425-555-0100", studioUrl: "https://p/studio/support/1" });
  assert.match(m.subject, /Blue Lake: New phone number/);
  assert.match(m.html, /href="https:\/\/p\/studio\/support\/1"/);
});

test("post-needs-OK email links to review and offers reply-to-approve", () => {
  const m = postNeedsOkEmail({ name: "Ann", title: "ADU costs in Everett", excerpt: "What it really costs.", held: false, reviewUrl: "https://p/login?next=%2Fautopilot" });
  assert.match(m.subject, /Ready for your OK: ADU costs in Everett/);
  assert.match(m.html, /Review the article/);
  assert.match(m.text, /looks good/);
});

test("monthly report shows numbers with plain arrows and what's waiting", () => {
  const m = monthlyReportEmail({ company: "Blue Lake", month: "November", lines: [{ label: "Leads from your website", now: 12, prev: 9 }, { label: "Visits to your website", now: 400, prev: 450 }, { label: "New Google reviews", now: 2, prev: null }], published: [{ title: "Deck permits 101", url: "https://bl.com/blog/deck" }], did: ["Fixed the contact form"], waiting: 1, portalUrl: "https://p/login" });
  assert.match(m.subject, /Blue Lake: your November update/);
  assert.match(m.html, /3 more than last month/);
  assert.match(m.html, /50 fewer than last month/);
  assert.match(m.html, /1 article is waiting for your OK/);
  assert.match(m.text, /Deck permits 101 https:\/\/bl\.com\/blog\/deck/);
});
