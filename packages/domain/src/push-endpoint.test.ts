import { describe, expect, it } from "vitest";
import {
  classifyPushEndpointUrl,
  isAcceptablePushEndpointShape,
  isAllowlistedPushHost,
  isBlockedPushAddress,
  PUSH_ENDPOINT_MAX_LENGTH,
  parsePushEndpointAllowlist,
} from "./push-endpoint";
import { reminderPushSubscriptionSchema } from "./reminders";

describe("Push endpoint shape", () => {
  it("accepts an ordinary provider endpoint", () => {
    const shape = classifyPushEndpointUrl("https://fcm.googleapis.com/fcm/send/abc-123");
    expect(shape).toMatchObject({ status: "ok", host: "fcm.googleapis.com" });
    expect(isAcceptablePushEndpointShape("https://updates.push.services.mozilla.com/wpush/v2/x"));
  });

  it("requires https", () => {
    for (const endpoint of [
      "http://push.example.com/x",
      "file:///etc/passwd",
      "gopher://push.example.com/x",
      "not a url",
    ]) {
      expect(classifyPushEndpointUrl(endpoint).status).toBe("blocked");
    }
  });

  it("refuses credentials in the authority and non-default ports", () => {
    expect(classifyPushEndpointUrl("https://user:pass@push.example.com/x").status).toBe("blocked");
    expect(classifyPushEndpointUrl("https://push.example.com:8080/x").status).toBe("blocked");
    expect(classifyPushEndpointUrl("https://push.example.com:22/x").status).toBe("blocked");
    expect(classifyPushEndpointUrl("https://push.example.com:443/x").status).toBe("ok");
  });

  it("bounds the stored length", () => {
    const long = `https://push.example.com/${"a".repeat(PUSH_ENDPOINT_MAX_LENGTH)}`;
    expect(classifyPushEndpointUrl(long).status).toBe("blocked");
  });

  it("refuses address literals that name the network we are inside", () => {
    for (const endpoint of [
      "https://127.0.0.1/x",
      "https://0.0.0.0/x",
      "https://10.1.2.3/x",
      "https://172.16.0.1/x",
      "https://192.168.1.1/x",
      "https://169.254.169.254/latest/meta-data/",
      "https://100.100.100.200/x",
      "https://[::1]/x",
      "https://[fd00:ec2::254]/x",
      "https://[fe80::1]/x",
      "https://[ff02::1]/x",
      "https://[::ffff:169.254.169.254]/x",
      // The URL parser canonicalises these to 127.0.0.1 before we see them.
      "https://0177.0.0.1/x",
      "https://2130706433/x",
    ]) {
      expect(classifyPushEndpointUrl(endpoint).status, endpoint).toBe("blocked");
    }
  });

  it("leaves public address literals alone", () => {
    expect(classifyPushEndpointUrl("https://93.184.216.34/x").status).toBe("ok");
    expect(classifyPushEndpointUrl("https://[2001:4860:4802:38::37]/x").status).toBe("ok");
  });

  it("classifies bare addresses the way a resolver hands them back", () => {
    expect(isBlockedPushAddress("169.254.169.254")).toBe(true);
    expect(isBlockedPushAddress("fd00:ec2::254")).toBe(true);
    expect(isBlockedPushAddress("::1")).toBe(true);
    expect(isBlockedPushAddress("93.184.216.34")).toBe(false);
    expect(isBlockedPushAddress("2001:4860:4802:38::37")).toBe(false);
    // Not an address at all; only resolution can judge a name.
    expect(isBlockedPushAddress("push.example.com")).toBe(false);
  });

  it("draws each blocked range at exactly the boundary the predicate always did", () => {
    // Last address inside a range stays blocked; the first address outside is
    // left alone. These pin the masked-CIDR match to the old hand-written edges.
    const blocked = [
      "100.64.0.0", // CGNAT floor
      "100.127.255.255", // CGNAT ceiling
      "172.16.0.0", // RFC 1918 /12 floor
      "172.31.255.255", // RFC 1918 /12 ceiling
      "192.0.255.255", // broad 192.0.0.0/16 ceiling
      "198.18.0.0", // benchmarking /15 floor
      "198.19.255.255", // benchmarking /15 ceiling
      "198.51.255.255", // broad TEST-NET-2 /16 ceiling
      "203.0.255.255", // broad TEST-NET-3 /16 ceiling
      "224.0.0.0", // multicast/reserved floor
      "255.255.255.255", // broadcast
    ];
    const allowed = [
      "100.63.255.255", // just below CGNAT
      "100.128.0.0", // just above CGNAT
      "172.15.255.255", // just below /12
      "172.32.0.0", // just above /12
      "192.1.0.0", // just above 192.0.0.0/16
      "198.17.255.255", // just below /15
      "198.20.0.0", // just above /15
      "198.50.255.255", // just below TEST-NET-2 /16
      "198.52.0.0", // just above TEST-NET-2 /16
      "203.1.0.0", // just above TEST-NET-3 /16
      "223.255.255.255", // just below multicast floor
    ];
    for (const address of blocked) expect(isBlockedPushAddress(address), address).toBe(true);
    for (const address of allowed) expect(isBlockedPushAddress(address), address).toBe(false);
  });

  it("draws each IPv6 prefix at exactly the boundary the predicate always did", () => {
    const blocked = [
      "2001:1ff::", // 2001::/23 ceiling
      "2001:db8::1", // documentation /32
      "100::", // discard-only /64 floor
      "100:0:0:0:ffff::", // still inside 100::/64
    ];
    const allowed = [
      "2001:200::", // just past 2001::/23
      "100:0:0:1::", // fourth group set, past 100::/64
    ];
    for (const address of blocked) expect(isBlockedPushAddress(address), address).toBe(true);
    for (const address of allowed) expect(isBlockedPushAddress(address), address).toBe(false);
  });

  it("treats an unset allowlist as no host restriction", () => {
    expect(parsePushEndpointAllowlist(undefined)).toBeNull();
    expect(parsePushEndpointAllowlist("  ")).toBeNull();
    expect(isAllowlistedPushHost("push.example.com", null)).toBe(true);
  });

  it("matches allowlist entries exactly or by leading wildcard", () => {
    const allowlist = parsePushEndpointAllowlist(
      "fcm.googleapis.com, *.notify.windows.com ,*.push.apple.com",
    );
    expect(allowlist).toEqual(["fcm.googleapis.com", "*.notify.windows.com", "*.push.apple.com"]);
    expect(isAllowlistedPushHost("fcm.googleapis.com", allowlist)).toBe(true);
    expect(isAllowlistedPushHost("db5p.notify.windows.com", allowlist)).toBe(true);
    expect(isAllowlistedPushHost("notify.windows.com", allowlist)).toBe(false);
    expect(isAllowlistedPushHost("evil-notify.windows.com.attacker.test", allowlist)).toBe(false);
    expect(isAllowlistedPushHost("push.example.com", allowlist)).toBe(false);
  });

  it("is enforced by the subscription schema itself", () => {
    const subscription = {
      expirationTime: null,
      keys: { p256dh: "key", auth: "auth" },
    };
    expect(
      reminderPushSubscriptionSchema.safeParse({
        ...subscription,
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      }).success,
    ).toBe(true);
    expect(
      reminderPushSubscriptionSchema.safeParse({
        ...subscription,
        endpoint: "https://169.254.169.254/latest/meta-data/",
      }).success,
    ).toBe(false);
  });
});
