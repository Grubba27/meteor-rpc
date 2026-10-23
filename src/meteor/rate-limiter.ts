// `ddp-rate-limiter` is an optional Meteor package: apps that never use `rateLimit`
// don't need it installed.
import { fromPackage } from "./package.js";

export interface RateLimitRule {
  type: "method" | "subscription";
  name: string;
  connectionId(): boolean;
  userId(): boolean;
  clientAddress(): boolean;
}

export interface RateLimiterStatic {
  addRule(rule: RateLimitRule, numRequests: number, timeInterval: number): string;
}

export function getRateLimiter(): RateLimiterStatic {
  return fromPackage<RateLimiterStatic>(
    "ddp-rate-limiter",
    "DDPRateLimiter",
    "`rateLimit` needs it: run `meteor add ddp-rate-limiter`.",
  );
}
