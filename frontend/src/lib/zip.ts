/**
 * Minimal ZIP parser for extracting manifest.json from an app ZIP.
 * Uses native DecompressionStream for DEFLATE decompression.
 */

export async function extractManifestFromZip(file: File): Promise<any> {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);

  // 1. Find End of Central Directory (EOCD)
  // EOCD is at least 22 bytes long, starts with 0x06054b50
  let eocdOffset = -1;
  for (let i = buffer.byteLength - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Invalid ZIP file: EOCD not found');
  }

  // 2. Parse EOCD to find Central Directory
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdEntries = view.getUint16(eocdOffset + 10, true);

  // 3. Iterate Central Directory entries to find manifest.json
  let currentOffset = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (view.getUint32(currentOffset, true) !== 0x02014b50) {
      throw new Error('Invalid Central Directory entry');
    }

    const fileNameLength = view.getUint16(currentOffset + 28, true);
    const extraFieldLength = view.getUint16(currentOffset + 30, true);
    const fileCommentLength = view.getUint16(currentOffset + 32, true);
    const relativeOffset = view.getUint32(currentOffset + 42, true);

    const fileNameBuffer = buffer.slice(currentOffset + 46, currentOffset + 46 + fileNameLength);
    const fileName = new TextDecoder().decode(fileNameBuffer);

    if (fileName === 'manifest.json') {
      return await extractFile(buffer, relativeOffset);
    }

    currentOffset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  throw new Error('manifest.json not found in ZIP');
}

async function extractFile(buffer: ArrayBuffer, localHeaderOffset: number): Promise<any> {
  const view = new DataView(buffer);

  if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
    throw new Error('Invalid Local File Header');
  }

  const compressionMethod = view.getUint16(localHeaderOffset + 8, true);
  const compressedSize = view.getUint32(localHeaderOffset + 18, true);
  // const uncompressedSize = view.getUint32(localHeaderOffset + 22, true);
  const fileNameLength = view.getUint16(localHeaderOffset + 26, true);
  const extraFieldLength = view.getUint16(localHeaderOffset + 28, true);

  const dataOffset = localHeaderOffset + 30 + fileNameLength + extraFieldLength;
  const data = buffer.slice(dataOffset, dataOffset + compressedSize);

  let decompressedData: ArrayBuffer;

  if (compressionMethod === 0) {
    // Stored (no compression)
    decompressedData = data;
  } else if (compressionMethod === 8) {
    // Deflated
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(new Uint8Array(data));
    writer.close();

    const response = new Response(ds.readable);
    decompressedData = await response.arrayBuffer();
  } else {
    throw new Error(`Unsupported compression method: ${compressionMethod}`);
  }

  const jsonString = new TextDecoder().decode(decompressedData);
  return JSON.parse(jsonString);
}
