/** What one section hands the next: an idea that becomes a procedure. Lives in memory only. */

import type { Idea } from "./types.ts";

let fromIdea: Idea | null = null;

export function handProcedureFromIdea(idea: Idea | null) {
  fromIdea = idea;
}

export function takeProcedureFromIdea(): Idea | null {
  const i = fromIdea;
  fromIdea = null;
  return i;
}
