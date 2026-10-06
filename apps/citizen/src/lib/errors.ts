/** Turns a failed Companion call into the message a resident should see. */

import type { Key } from "./i18n.ts";

/** `signin` and `not_found` come only from the commune's desk: no valid code on the device, or the thing is gone. */
export type FailureKind = "unavailable" | "busy" | "too_long" | "signin" | "not_found";

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
    if (error.kind === "signin") return "desk_signin_needed";
    if (error.kind === "not_found") return "desk_not_found";
    return "error_too_long";
  }
  return "error";
}
