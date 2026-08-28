/**
 * Minimal, dependency-free ZIP reader.
 *
 * Why hand-rolled instead of a library: we only ever need 2-3 small JSON files
 * out of an archive that can be several gigabytes (a full Instagram export is
 * mostly photos and videos). This reader parses the central directory and then
 * slices *only* the byte ranges of the entries we actually want, so opening a
 * 4 GB export costs about as much memory as opening a 4 MB one. Loading the
 * whole archive into memory - which is what the usual libraries do - reliably
 * crashes mobile browsers.
 *
 * Decompression uses the platform's DecompressionStream (Chrome 103+,
 * Safari 16.4+, Firefox 113+). No third-party code, nothing to vendor.
 */

const EOCD_SIG = 0x06054b50;
const EOCD64_SIG = 0x06064b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const CENTRAL_SIG = 0x02014b50;

const EOCD_MIN_SIZE = 22;
const ZIP64_MAGIC_32 = 0xffffffff;
const ZIP64_MAGIC_16 = 0xffff;

export class ZipError extends Error {}

const utf8 = new TextDecoder('utf-8');

async function readSlice(blob, start, end) {
  const clampedStart = Math.max(0, start);
  const clampedEnd = Math.min(blob.size, end);
  if (clampedEnd <= clampedStart) return new DataView(new ArrayBuffer(0));
  const buffer = await blob.slice(clampedStart, clampedEnd).arrayBuffer();
  return new DataView(buffer);
}

/** ZIP stores 64-bit values as two 32-bit halves; recombine as a JS number. */
function getUint64(view, offset) {
  const low = view.getUint32(offset, true);
  const high = view.getUint32(offset + 4, true);
  return high * 0x100000000 + low;
}

/**
 * Scan backwards from the end of the file for the End Of Central Directory
 * record. It sits at the very end unless the archive carries a trailing
 * comment, which can be up to 64 KB.
 */
async function findEocd(blob) {
  const maxCommentSize = 0xffff;
  const searchSize = Math.min(blob.size, maxCommentSize + EOCD_MIN_SIZE);
  const searchStart = blob.size - searchSize;
  const view = await readSlice(blob, searchStart, blob.size);

  for (let i = view.byteLength - EOCD_MIN_SIZE; i >= 0; i--) {
    if (view.getUint32(i, true) !== EOCD_SIG) continue;
    return { view, offsetInView: i, absoluteOffset: searchStart + i };
  }
  throw new ZipError('Not a valid ZIP file (no end-of-archive record found).');
}

/**
 * Locate the central directory, transparently handling ZIP64. Archives over
 * 4 GB or with more than 65535 entries store the real values in a ZIP64 record
 * and leave sentinel values in the classic one - a full Instagram export with
 * years of video easily crosses that line.
 */
async function locateCentralDirectory(blob) {
  const eocd = await findEocd(blob);
  const { view, offsetInView } = eocd;

  let entryCount = view.getUint16(offsetInView + 10, true);
  let directorySize = view.getUint32(offsetInView + 12, true);
  let directoryOffset = view.getUint32(offsetInView + 16, true);

  const needsZip64 =
    entryCount === ZIP64_MAGIC_16 ||
    directorySize === ZIP64_MAGIC_32 ||
    directoryOffset === ZIP64_MAGIC_32;

  if (!needsZip64) return { entryCount, directorySize, directoryOffset };

  const locator = await readSlice(blob, eocd.absoluteOffset - 20, eocd.absoluteOffset);
  if (locator.byteLength < 20 || locator.getUint32(0, true) !== EOCD64_LOCATOR_SIG) {
    throw new ZipError('This ZIP declares ZIP64 but the ZIP64 locator is missing.');
  }

  const zip64Offset = getUint64(locator, 8);
  const zip64 = await readSlice(blob, zip64Offset, zip64Offset + 56);
  if (zip64.byteLength < 56 || zip64.getUint32(0, true) !== EOCD64_SIG) {
    throw new ZipError('This ZIP declares ZIP64 but the ZIP64 record is missing.');
  }

  entryCount = getUint64(zip64, 32);
  directorySize = getUint64(zip64, 40);
  directoryOffset = getUint64(zip64, 48);
  return { entryCount, directorySize, directoryOffset };
}

/**
 * Some fields in a central directory header are sentinels pointing at a ZIP64
 * extra field. The extra field packs only the values that overflowed, in a
 * fixed order, so we consume them in that same order.
 */
function readZip64Extra(view, start, length, needed) {
  const result = {};
  let cursor = start;
  const end = start + length;

  while (cursor + 4 <= end) {
    const headerId = view.getUint16(cursor, true);
    const dataSize = view.getUint16(cursor + 2, true);
    const dataStart = cursor + 4;

    if (headerId === 0x0001) {
      let field = dataStart;
      if (needed.uncompressedSize && field + 8 <= dataStart + dataSize) {
        result.uncompressedSize = getUint64(view, field);
        field += 8;
      }
      if (needed.compressedSize && field + 8 <= dataStart + dataSize) {
        result.compressedSize = getUint64(view, field);
        field += 8;
      }
      if (needed.localHeaderOffset && field + 8 <= dataStart + dataSize) {
        result.localHeaderOffset = getUint64(view, field);
      }
      return result;
    }
    cursor = dataStart + dataSize;
  }
  return result;
}

/**
 * List every entry in the archive without reading any file contents.
 * Returns lightweight descriptors that readEntryText() can later resolve.
 */
export async function listEntries(blob) {
  const { entryCount, directorySize, directoryOffset } = await locateCentralDirectory(blob);
  const view = await readSlice(blob, directoryOffset, directoryOffset + directorySize);

  const entries = [];
  let cursor = 0;

  for (let i = 0; i < entryCount; i++) {
    if (cursor + 46 > view.byteLength) break;
    if (view.getUint32(cursor, true) !== CENTRAL_SIG) break;

    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);

    let compressedSize = view.getUint32(cursor + 20, true);
    let uncompressedSize = view.getUint32(cursor + 24, true);
    let localHeaderOffset = view.getUint32(cursor + 42, true);

    const nameStart = cursor + 46;
    const nameBytes = new Uint8Array(view.buffer, view.byteOffset + nameStart, nameLength);
    // Bit 11 flags UTF-8 names. Instagram's paths are ASCII either way, and
    // UTF-8 is a superset of ASCII, so decoding as UTF-8 is always safe here.
    const path = utf8.decode(nameBytes);

    const needsZip64 =
      compressedSize === ZIP64_MAGIC_32 ||
      uncompressedSize === ZIP64_MAGIC_32 ||
      localHeaderOffset === ZIP64_MAGIC_32;

    if (needsZip64) {
      const extra = readZip64Extra(view, nameStart + nameLength, extraLength, {
        uncompressedSize: uncompressedSize === ZIP64_MAGIC_32,
        compressedSize: compressedSize === ZIP64_MAGIC_32,
        localHeaderOffset: localHeaderOffset === ZIP64_MAGIC_32,
      });
      if (extra.uncompressedSize !== undefined) uncompressedSize = extra.uncompressedSize;
      if (extra.compressedSize !== undefined) compressedSize = extra.compressedSize;
      if (extra.localHeaderOffset !== undefined) localHeaderOffset = extra.localHeaderOffset;
    }

    const isDirectory = path.endsWith('/');
    if (!isDirectory) {
      entries.push({ path, method, flags, compressedSize, uncompressedSize, localHeaderOffset });
    }

    cursor = nameStart + nameLength + extraLength + commentLength;
  }

  return entries;
}

/**
 * Read one entry as text. The central directory records where the local header
 * sits, but the local header's own name/extra lengths are the authoritative
 * ones for finding where the compressed bytes begin.
 */
export async function readEntryText(blob, entry) {
  const header = await readSlice(blob, entry.localHeaderOffset, entry.localHeaderOffset + 30);
  if (header.byteLength < 30) {
    throw new ZipError(`Truncated archive while reading "${entry.path}".`);
  }

  const nameLength = header.getUint16(26, true);
  const extraLength = header.getUint16(28, true);
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const dataBlob = blob.slice(dataStart, dataStart + entry.compressedSize);

  if (entry.method === 0) return dataBlob.text();

  if (entry.method !== 8) {
    throw new ZipError(
      `"${entry.path}" uses an unsupported compression method (${entry.method}).`
    );
  }

  if (typeof DecompressionStream === 'undefined') {
    throw new ZipError(
      'This browser cannot unzip files. Please unzip the export yourself and upload the JSON files.'
    );
  }

  const stream = dataBlob.stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

/**
 * Read only the entries a caller cares about.
 * `predicate` receives the entry path so callers can skip the thousands of
 * media files in a full export without ever touching their bytes.
 */
export async function readMatchingEntries(blob, predicate) {
  const entries = await listEntries(blob);
  const wanted = entries.filter((entry) => predicate(entry.path));

  const results = [];
  for (const entry of wanted) {
    try {
      results.push({ path: entry.path, text: await readEntryText(blob, entry) });
    } catch (error) {
      // One unreadable entry shouldn't sink the whole import - the other
      // files may still be enough to produce a result.
      results.push({ path: entry.path, text: null, error });
    }
  }
  return results;
}
