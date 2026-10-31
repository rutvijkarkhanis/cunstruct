// Writes the engine freeze manifest.  npx vite-node --root . scripts/accuracy/mq/freezeManifest.ts --out <file.json> [--check <earlier.json>]
import { args, need, readJson, writeJson } from "./common";
import { freezeManifest } from "./fingerprint";

const a = args();
const m = freezeManifest();
if (a.check) {
  const old = readJson<ReturnType<typeof freezeManifest>>(a.check);
  const changed = m.engine_files.filter((f) => old.engine_files.find((o) => o.file === f.file)?.sha256 !== f.sha256).map((f) => f.file);
  console.log(changed.length || m.candidate.fingerprint !== old.candidate.fingerprint ? `CHANGED: ${changed.join(", ")}` : `UNCHANGED ${m.candidate.fingerprint}`);
  if (changed.length) process.exit(1);
} else {
  writeJson(need(a, "out"), m);
  console.log(`candidate ${m.candidate.fingerprint}\ncore four ${m.core_four.fingerprint}\n${m.engine_files.map((f) => `${f.sha256}  ${f.file} (${f.reachedBy})`).join("\n")}`);
}
