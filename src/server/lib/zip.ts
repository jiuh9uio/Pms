import { crc32 } from 'node:zlib';

/**
 * Sehr kleiner ZIP-Schreiber (ohne Komprimierung, „stored“): genügt, um PDF- und XML-Dateien zu einem Paket zu bündeln.
 * Dateinamen in UTF-8. Keine ZIP64-Unterstützung – also unter 4 GB und 65 535 Dateien.
 */
export function zipStore(files: { name: string; data: Buffer }[], when = new Date()): Buffer {
  const dosTime = ((when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()) & 0xffff;
  const parts: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), crc = crc32(f.data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.data.length, 18); local.writeUInt32LE(f.data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(20, 6); head.writeUInt16LE(0x0800, 8); head.writeUInt16LE(0, 10);
    head.writeUInt16LE(dosTime, 12); head.writeUInt16LE(dosDate, 14); head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(f.data.length, 20); head.writeUInt32LE(f.data.length, 24); head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(offset, 42);
    parts.push(local, name, f.data);
    central.push(head, name);
    offset += 30 + name.length + f.data.length;
  }
  const dir = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}
