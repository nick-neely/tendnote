/**
 * Picks a person the Eve composer placeholder can name, so the prompt suggests
 * someone the owner actually keeps rather than an invented example.
 *
 * Preference order is "who is Tendnote already nudging me about": the person
 * behind the soonest active reminder, then the first person in the directory.
 * A brand-new notebook has neither, and `null` lets the composer fall back to a
 * name-free prompt instead of inventing a name.
 */
export function suggestComposerPerson(
  followups: readonly { personName: string | null }[],
  people: readonly { displayName: string }[],
): string | null {
  return (
    followups.find((followup) => followup.personName)?.personName ?? people[0]?.displayName ?? null
  );
}
