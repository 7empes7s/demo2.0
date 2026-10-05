/** Turns a failed Companion call into the message a resident should see. */

import type { Key } from "./i18n.ts";

export type FailureKind = "unavailable" | "busy" | "too_long";

export class CompanionFailure extends Error {
  readonly kind: FailureKind;
  constructor(kind: FailureKind, message = kind) {
    super(message);
    this.kind = kind;
  }
}

export function errorKey(error: unknown): Key {
  if (error instanceof CompanionFailure) {
    if (error.kind === "unavailable") return "error_unavailable";
    if (error.kind === "busy") return "error_busy";
    return "error_too_long";
  }
  return "error";
}
