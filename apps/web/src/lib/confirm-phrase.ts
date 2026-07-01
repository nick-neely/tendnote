/**
 * A spoken-word confirmation phrase for high-stakes, irreversible actions (deleting
 * a person who has memories, follow-ups, or drafts attached). The user must retype a
 * short randomly-generated phrase like `sage-wren-cove`, which forces a deliberate
 * pause instead of a reflexive click on a familiar button.
 *
 * The word pool is intentionally small, lowercase, and short (3-6 letters), with no
 * homophones or easily-confused pairs, so the phrase is quick to read and retype. It
 * leans on the field-notebook's natural vocabulary to stay on-voice rather than
 * feeling like a captcha.
 */
const CONFIRM_WORDS = [
  "sage",
  "clay",
  "fern",
  "moss",
  "pine",
  "reed",
  "oak",
  "elm",
  "cedar",
  "river",
  "brook",
  "cove",
  "vale",
  "dune",
  "ridge",
  "field",
  "grove",
  "wren",
  "lark",
  "dove",
  "finch",
  "robin",
  "heron",
  "otter",
  "hare",
  "fox",
  "deer",
  "amber",
  "slate",
  "ochre",
  "teal",
  "rust",
  "dawn",
  "dusk",
  "frost",
  "ember",
] as const;

/** Uniform random in [0, 1); crypto-backed in the browser, `Math.random` otherwise. */
function defaultRng(): number {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return (buffer[0] ?? 0) / 2 ** 32;
  }

  return Math.random();
}

/**
 * Builds a hyphen-joined phrase of `wordCount` distinct words sampled from the pool.
 * `rng` is injectable so tests can pin the selection; production uses a crypto-backed
 * source. The `wordCount` is clamped to the pool size so the words are always distinct.
 */
export function generateConfirmPhrase(rng: () => number = defaultRng, wordCount = 3): string {
  const pool = [...CONFIRM_WORDS];
  const take = Math.min(wordCount, pool.length);
  const picked: string[] = [];

  for (let i = 0; i < take; i++) {
    // Clamp guards the exclusive-1 contract even if an injected rng returns exactly 1.
    const index = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
    const [word] = pool.splice(index, 1);
    if (word !== undefined) {
      picked.push(word);
    }
  }

  return picked.join("-");
}

/** Whether the user's input matches the phrase, forgiving surrounding space and case. */
export function confirmPhraseMatches(input: string, phrase: string): boolean {
  return input.trim().toLowerCase() === phrase;
}
