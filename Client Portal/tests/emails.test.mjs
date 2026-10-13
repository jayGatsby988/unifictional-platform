import { test } from "node:test";
import assert from "node:assert/strict";
import { welcomeEmail, signInLinkEmail, dashboardReadyEmail, studioNewSignupEmail } from "../lib/email/templates.ts";

test("welcome email carries login details, greets by first name, escapes input", () => {
  const m = welcomeEmail({ name: "Dave <b>Smith</b>", email: "dave@acme.com", tempPassword: "Cedar-Ridge-4821", signInUrl: "https://portal.example/auth/welcome?t=abc", loginUrl: "https://portal.example/login", company: "Acme & Sons" });
  assert.match(m.subject, /Welcome to Unifictional/);
  assert.match(m.html, /Thanks for choosing Unifictional, Dave/);
  assert.ok(!m.html.includes("<b>Smith</b>"), "user text is escaped");
  assert.match(m.html, /Acme &amp; Sons/);
  assert.match(m.html, /Cedar-Ridge-4821/);
  assert.match(m.html, /href="https:\/\/portal\.example\/login"/);
  assert.match(m.text, /Temporary password: Cedar-Ridge-4821/);
});

test("welcome email leads with the one-tap button and keeps the password one tap to copy", () => {
  const m = welcomeEmail({ name: "Dave", email: "dave@acme.com", tempPassword: "Cedar-Ridge-4821", signInUrl: "https://portal.example/auth/welcome?t=abc", loginUrl: "https://portal.example/login?email=dave%40acme.com" });
  const oneTap = m.html.indexOf('href="https://portal.example/auth/welcome?t=abc"');
  assert.ok(oneTap > 0, "one-tap sign-in button is there");
  assert.ok(oneTap < m.html.indexOf("Cedar-Ridge-4821"), "the button comes before the typed fallback");
  assert.match(m.html, /user-select:all[^>]*>Cedar-Ridge-4821</);
  assert.match(m.text, /SIGN ME IN: https:\/\/portal\.example\/auth\/welcome\?t=abc/);
});

test("sign-in link, dashboard-ready and studio emails include their links", () => {
  assert.match(signInLinkEmail({ name: "Ann", link: "https://x/auth/confirm?t=1" }).html, /href="https:\/\/x\/auth\/confirm\?t=1"/);
  assert.match(dashboardReadyEmail({ name: "", company: "Blue Lake", loginUrl: "https://x/login" }).subject, /Blue Lake dashboard is ready/);
  const s = studioNewSignupEmail({ name: "Ann", company: "Co", email: "a@b.co", studioUrl: "https://x/studio/signup/1", reportUrl: "https://x/report/2" });
  assert.match(s.html, /studio\/signup\/1/);
  assert.match(s.text, /report\/2/);
});

test("sign-off names the sender when given, else the team", () => {
  const withRebecca = welcomeEmail({ name: "Ann", email: "a@b.co", tempPassword: "X-Y-1234", signInUrl: "https://x/w", loginUrl: "https://x", signOff: { name: "Rebecca", title: "Client onboarding, Unifictional" } });
  assert.match(withRebecca.html, /<b>Rebecca<\/b>/);
  const team = dashboardReadyEmail({ name: "Ann", company: "Co", loginUrl: "https://x" });
  assert.match(team.html, /The Unifictional team/);
});
