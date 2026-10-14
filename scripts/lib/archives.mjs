// Lecture d'archives sans dépendance : tar.gz parcouru fichier par fichier (sans tout
// décompresser sur le disque), et zip (le format des partitions MusicXML compressées .mxl).

import { createGunzip, inflateRawSync } from 'node:zlib';

/**
 * Les fichiers d'une archive tar.gz lue depuis un flux, un par un. Seuls ceux que `want`
 * accepte sont gardés en mémoire ; les autres sont sautés au fil de la lecture, ce qui
 * permet de traverser une archive de plusieurs Go sans la stocker.
 */
export async function* tarEntries(stream, want = () => true) {
  const pending = [];
  let pendingLength = 0;
  const take = (n) => {
    const parts = [];
    let need = n;
    while (need > 0) {
      const chunk = pending[0];
      if (chunk.length <= need) {
        parts.push(chunk);
        pending.shift();
        need -= chunk.length;
      } else {
        parts.push(chunk.subarray(0, need));
        pending[0] = chunk.subarray(need);
        need = 0;
      }
    }
    pendingLength -= n;
    return parts.length === 1 ? parts[0] : Buffer.concat(parts);
  };

  let entry = null;
  let longName = null;
  for await (const chunk of stream.pipe(createGunzip())) {
    pending.push(chunk);
    pendingLength += chunk.length;
    for (;;) {
      if (!entry) {
        if (pendingLength < 512) break;
        const header = take(512);
        if (header.every((b) => b === 0)) continue;
        const cut = (start, end) => header.subarray(start, end).toString().replace(/\0.*$/s, '');
        const size = parseInt(cut(124, 136).trim() || '0', 8);
        const type = String.fromCharCode(header[156]);
        const prefix = cut(345, 500);
        const name = (longName ?? (prefix ? `${prefix}/${cut(0, 100)}` : cut(0, 100))).replace(/^\.\//, '');
        longName = null;
        const keep = type === 'L' || ((type === '0' || type === '\0') && want(name));
        entry = { name, type, size, remaining: Math.ceil(size / 512) * 512, keep, parts: [] };
        continue;
      }
      if (pendingLength === 0) break;
      const part = take(Math.min(entry.remaining, pendingLength));
      if (entry.keep) entry.parts.push(part);
      entry.remaining -= part.length;
      if (entry.remaining > 0) break;
      const done = entry;
      entry = null;
      if (!done.keep) continue;
      const data = Buffer.concat(done.parts).subarray(0, done.size);
      if (done.type === 'L') longName = data.toString().replace(/\0.*$/s, '');
      else yield { name: done.name, data };
    }
  }
}

/** Les fichiers d'une archive zip en mémoire. */
export function zipEntries(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) return [];
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(start, start + size);
    entries.push({ name, read: () => (method === 8 ? inflateRawSync(raw) : raw) });
    offset += 46 + nameLength + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  return entries;
}
