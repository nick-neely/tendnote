/**
 * The countries the hosted Region Block refuses: the European Union (including
 * outermost regions and Åland, which carry their own ISO 3166 codes), the rest
 * of the EEA, the United Kingdom, and Switzerland. The block is a filter rather
 * than a legal shield, and it exists only in hosted admission mode.
 */
const REGION_BLOCKED_COUNTRIES: ReadonlySet<string> = new Set([
  // European Union
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
  // EU territories with their own country codes
  "AX",
  "GF",
  "GP",
  "MF",
  "MQ",
  "RE",
  "YT",
  // Rest of the EEA
  "IS",
  "LI",
  "NO",
  // United Kingdom and Switzerland
  "GB",
  "CH",
]);

/**
 * Whether a request country is refused. An absent or unrecognised country is
 * never refused: the edge header is a cheap filter for the common case, and
 * Stripe's US billing-country restriction is the layer that costs money.
 */
export function isRegionBlockedCountry(country: string | null | undefined): boolean {
  if (!country) {
    return false;
  }
  return REGION_BLOCKED_COUNTRIES.has(country.trim().toUpperCase());
}
