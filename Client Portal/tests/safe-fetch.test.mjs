import { test } from "node:test";
import assert from "node:assert/strict";

const { isPrivateAddress, safeFetch } = await import("../lib/safe-fetch.ts");

test("private, loopback, link-local and metadata addresses are refused", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "76.76.21.21", "172.32.0.1", "2606:4700::1111"]) assert.equal(isPrivateAddress(ip), false, ip);
});

test("safeFetch rejects internal targets before connecting", async () => {
  await assert.rejects(safeFetch("http://169.254.169.254/latest/meta-data/"), /public website/);
  await assert.rejects(safeFetch("http://127.0.0.1:3000/"), /public website/);
  await assert.rejects(safeFetch("file:///etc/passwd"), /http or https/);
});
