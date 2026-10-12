import { test } from "node:test";
import assert from "node:assert/strict";
import { welcomeEmail, signInLinkEmail, dashboardReadyEmail, studioNewSignupEmail } from "../lib/email/templates.ts";

test("welcome email carries login details, greets by first name, escapes input", () => {
  const m = welcomeEmail({ name: "Dave <b>Smith</b>", email: "dave@acme.com", tempPassword: "Cedar-Ridge-4821", loginUrl: "https://portal.example/login", company: "Acme & Sons" });
  assert.match(m.subject, /Welcome to Unifictional/);
  assert.match(m.html, /Thanks for choosing Unifictional, Dave/);
  assert.ok(!m.html.includes("<b>Smith</b>"), "user text is escaped");
  assert.match(m.html, /Acme &amp; Sons/);
  assert.match(m.html, /Cedar-Ridge-4821/);
  assert.match(m.html, /href="https:\/\/portal\.example\/login"/);
  assert.match(m.text, /Temporary password: Cedar-Ridge-4821/);
});

test("sign-in link, dashboard-ready and studio emails include their links", () => {
  assert.match(signInLinkEmail({ name: "Ann", link: "https://x/auth/confirm?t=1" }).html, /href="https:\/\/x\/auth\/confirm\?t=1"/);
  assert.match(dashboardReadyEmail({ name: "", company: "Blue Lake", loginUrl: "https://x/login" }).subject, /Blue Lake dashboard is ready/);
  const s = studioNewSignupEmail({ name: "Ann", company: "Co", email: "a@b.co", studioUrl: "https://x/studio/signup/1", reportUrl: "https://x/report/2" });
  assert.match(s.html, /studio\/signup\/1/);
  assert.match(s.text, /report\/2/);
});

test("sign-off names the sender when given, else the team", () => {
  const withRebecca = welcomeEmail({ name: "Ann", email: "a@b.co", tempPassword: "X-Y-1234", loginUrl: "https://x", signOff: { name: "Rebecca", title: "Client onboarding, Unifictional" } });
  assert.match(withRebecca.html, /<b>Rebecca<\/b>/);
  const team = dashboardReadyEmail({ name: "Ann", company: "Co", loginUrl: "https://x" });
  assert.match(team.html, /The Unifictional team/);
});
