import type { RateLimitResult } from "./types";

/** A stable, owner-safe failure raised when a product action exhausts its budget. */
export class ProductRateLimitError extends Error {
  readonly result: RateLimitResult;

  constructor(result: RateLimitResult) {
    super("You've reached a usage limit for this action. Please try again shortly.");
    this.name = "ProductRateLimitError";
    this.result = result;
  }
}
