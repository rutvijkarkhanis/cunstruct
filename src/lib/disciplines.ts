// Multi-discipline BOQ. A project can have one BOQ per discipline. Disciplines are
// a simple label set used to tag and name a BOQ; quantities and rates are entered
// by the operator (or imported) — Cunstruct does not generate them.

export interface Discipline {
  key: string;
  name: string;
  short: string;
}

export const DISCIPLINES: Discipline[] = [
  { key: "civil", name: "Civil Works", short: "Civil" },
  { key: "plumbing", name: "Plumbing Works", short: "Plumbing" },
  { key: "electrical", name: "Electrical Works", short: "Electrical" },
  { key: "hvac", name: "HVAC Works", short: "HVAC" },
  { key: "fire", name: "Fire Fighting & Alarm", short: "Fire" },
];

export const disciplineByKey = (key: string) => DISCIPLINES.find((d) => d.key === key) ?? DISCIPLINES[0];
