function forEachStoredZipEntry(
  bytes: Uint8Array,
  visit: (name: string, content: Uint8Array) => void,
) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 30 <= bytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const size = view.getUint32(offset + 18, true);
    const nameStart = offset + 30;
    const contentStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    visit(name, bytes.slice(contentStart, contentStart + size));
    offset = contentStart + size;
  }
}

export function readStoredZipEntries(bytes: Uint8Array) {
  const entries = new Map<string, string>();
  const decoder = new TextDecoder();
  forEachStoredZipEntry(bytes, (name, content) => {
    entries.set(name, decoder.decode(content));
  });
  return entries;
}

export function readStoredZipEntryBytes(bytes: Uint8Array, wantedPath: string) {
  let found: Uint8Array | undefined;
  forEachStoredZipEntry(bytes, (name, content) => {
    if (name === wantedPath) found = content;
  });
  if (found) return found;
  throw new Error(`Missing ZIP entry ${wantedPath}`);
}
