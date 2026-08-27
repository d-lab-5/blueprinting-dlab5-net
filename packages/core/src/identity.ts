/**
 * Product identity (ADR-0009).
 *
 * A product's id is minted, never derived from its name. Deriving it was the
 * old behaviour and it made renaming impossible: the id is the DynamoDB
 * partition key, the Cognito group and the S3 prefix are computed from it, and
 * every IRI in the model embeds it. Any of those derived from a name becomes
 * wrong the moment the name changes.
 */

/**
 * No vowels, so a minted id cannot spell a word — an id that reads as a word
 * invites someone to treat it as meaningful, which is the habit this whole
 * decision exists to break. No `0`, `1`, `l` or `o` either: ids get read aloud
 * and typed from screenshots.
 */
const ALPHABET = "23456789bcdfghjkmnpqrstvwxz";

/** Kept short enough to stay readable in a URL, long enough not to collide. */
const LENGTH = 10;

export const PRODUCT_ID_PREFIX = "p-";

/**
 * Matches what `projectAdmin` accepts, and is the reason the prefixed form was
 * chosen over a bare id: it is already a legal slug, so nothing downstream
 * changes shape.
 */
export const PRODUCT_ID = /^p-[23456789bcdfghjkmnpqrstvwxz]{10}$/;

/**
 * A fresh product id, e.g. `p-7f3k2b9c4d`.
 *
 * Uses rejection sampling rather than `% ALPHABET.length`, which would make
 * the first few characters of the alphabet more likely. The bias would be
 * small and completely invisible, which is exactly why it is worth not having.
 */
export function mintProductId(
  randomBytes: (n: number) => Uint8Array = defaultRandomBytes
): string {
  const max = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let out = "";
  while (out.length < LENGTH) {
    for (const byte of randomBytes(LENGTH)) {
      if (byte >= max) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === LENGTH) break;
    }
  }
  return PRODUCT_ID_PREFIX + out;
}

function defaultRandomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** Whether an id was minted rather than derived from a name. */
export function isMintedProductId(slug: string): boolean {
  return PRODUCT_ID.test(slug);
}
