// Owner profile for the unified importer.
//
// The owner's TNG identifier is stored OBFUSCATED (base64) on purpose so it
// never appears as a plaintext literal in the source tree. It is used only to
// auto-suggest the account hint when a parsed statement references the same
// identifier. It is NEVER written to logs, AsyncStorage, SecureStore, or the
// ImportBatch undo record.
//
// NOTE: embedding a fixed personal identifier here is a deliberate user request.
// A better long-term home is an editable setting; this keeps it out of PII
// surfaces for now.

const OBF = 'MTczMTU4OTQw'; // base64 of the owner TNG identifier (NOT plaintext)

/** Decode the obfuscated owner TNG identifier without a Buffer dependency. */
export function getOwnerTngIdentifier(): string {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let bin = '';
  for (let i = 0; i < OBF.length; i += 4) {
    const a = B64.indexOf(OBF[i]);
    const b = B64.indexOf(OBF[i + 1]);
    const c = B64.indexOf(OBF[i + 2]);
    const d = B64.indexOf(OBF[i + 3]);
    bin += String.fromCharCode((a << 2) | (b >> 4));
    if (c !== -1) bin += String.fromCharCode(((b & 15) << 4) | (c >> 2));
    if (d !== -1) bin += String.fromCharCode(((c & 3) << 6) | d);
  }
  return bin;
}

/** Account-hint label applied when a statement is recognized as the owner's. */
export const OWNER_TNG_ACCOUNT_HINT = 'TNG';

/** True when the statement text references the owner's TNG identifier. */
export function statementMentionsOwner(text: string): boolean {
  if (!text) return false;
  try {
    return text.includes(getOwnerTngIdentifier());
  } catch {
    return false;
  }
}
