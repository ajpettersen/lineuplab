// Pairing rules (Settings → Rotation): "never on court together" groups and
// "keep at least one of these on court" groups (e.g. a ball-handler). Shared
// by the rotation (Bench Sheet / Set Lineup), Rebalance and the court display.
// No imports from the rotation, so everything can use it.

export interface PairingRules {
  neverTogether: string[][];
  atLeastOne: { label: string; ids: string[] }[];
}

export const NO_PAIRING_RULES: PairingRules = { neverTogether: [], atLeastOne: [] };

export function hasPairingRules(rules: PairingRules | null | undefined): rules is PairingRules {
  return !!rules && (rules.neverTogether.length > 0 || rules.atLeastOne.length > 0);
}

/** Every rule this five breaks, as short descriptions ("Luke and Henry together", "no ball-handler"). */
export function pairingProblems(
  five: string[],
  rules: PairingRules,
  available: Set<string>,
  nameOf: (id: string) => string = (id) => id,
): { kind: "never" | "atLeastOne"; text: string; key: string }[] {
  const out: { kind: "never" | "atLeastOne"; text: string; key: string }[] = [];
  rules.neverTogether.forEach((group, i) => {
    const together = group.filter((id) => five.includes(id));
    if (together.length >= 2) out.push({ kind: "never", key: `never:${i}`, text: `${together.map(nameOf).join(" and ")} together` });
  });
  rules.atLeastOne.forEach((rule, i) => {
    if (rule.ids.some((id) => five.includes(id))) return;
    const any = rule.ids.some((id) => available.has(id));
    out.push({ kind: "atLeastOne", key: `one:${i}`, text: any ? `no ${rule.label} on court` : `no ${rule.label} available` });
  });
  return out;
}

/** The first rule a five breaks, as a sentence, or null. */
export function pairingProblem(
  five: string[],
  rules: PairingRules,
  available: Set<string>,
  nameOf: (id: string) => string = (id) => id,
): string | null {
  const [first] = pairingProblems(five, rules, available, nameOf);
  if (!first) return null;
  if (first.kind === "never") return `${first.text.replace(/ together$/, "")} are on court together (never-together rule)`;
  return first.text.charAt(0).toUpperCase() + first.text.slice(1);
}

/** Count of rule breaks across a list of fives (for comparing orders). */
export function violationCount(fives: string[][], rules: PairingRules, available: Set<string>): number {
  return fives.reduce((n, five) => n + pairingProblems(five, rules, available).length, 0);
}
