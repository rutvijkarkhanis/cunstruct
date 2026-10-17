// Plain-language reason for a failed save, for messages like "Not saved — …".
// Users should learn what happened and what to do, not see "TypeError: Failed
// to fetch" (NN/g heuristic 9; GOV.UK error-message guidance).
export function saveErrorMessage(err: unknown): string {
  const msg = String((err as { message?: unknown })?.message ?? err ?? "").trim();
  const code = String((err as { code?: unknown })?.code ?? "");
  if (/failed to fetch|networkerror|network request failed|load failed|ERR_/i.test(msg)) {
    return "the connection to the server failed. Check your connection and try again.";
  }
  if (code === "42501" || /row-level security|permission denied|not authori[sz]ed|JWT/i.test(msg)) {
    return "you don't have permission to change this. Ask an admin if you should.";
  }
  return msg || "something went wrong. Try again.";
}
