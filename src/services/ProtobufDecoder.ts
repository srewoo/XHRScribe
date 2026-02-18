import { ProtobufField, ProtobufDecodeResult } from '@/types';

export class ProtobufDecoder {
  private static instance: ProtobufDecoder;

  private constructor() {}

  static getInstance(): ProtobufDecoder {
    if (!ProtobufDecoder.instance) {
      ProtobufDecoder.instance = new ProtobufDecoder();
    }
    return ProtobufDecoder.instance;
  }

  isProtobufContentType(contentType: string): boolean {
    const lower = (contentType || '').toLowerCase();
    return lower.includes('grpc') || lower.includes('protobuf') || lower.includes('x-protobuf');
  }

  decode(base64Data: string): ProtobufDecodeResult {
    try {
      const bytes = this.base64ToBytes(base64Data);
      if (bytes.length === 0) {
        return { success: false, fields: [], error: 'Empty data', rawHex: '' };
      }

      const fields: ProtobufField[] = [];
      let offset = 0;

      while (offset < bytes.length) {
        // Read the tag (varint)
        const tagResult = this.readVarint(bytes, offset);
        if (!tagResult) break;

        const tag = tagResult.value;
        offset = tagResult.offset;

        const fieldNumber = tag >> 3;
        const wireType = tag & 0x07;

        if (fieldNumber === 0) break; // Invalid field number

        const wireTypeName = this.getWireTypeName(wireType);
        let value: string | number | Uint8Array;

        switch (wireType) {
          case 0: { // Varint
            const result = this.readVarint(bytes, offset);
            if (!result) { return this.failResult(fields, bytes, 'Failed to read varint value'); }
            value = result.value;
            offset = result.offset;
            break;
          }
          case 1: { // 64-bit
            if (offset + 8 > bytes.length) { return this.failResult(fields, bytes, 'Truncated 64-bit field'); }
            value = this.readFixed64(bytes, offset);
            offset += 8;
            break;
          }
          case 2: { // Length-delimited (string, bytes, embedded message)
            const lenResult = this.readVarint(bytes, offset);
            if (!lenResult) { return this.failResult(fields, bytes, 'Failed to read length'); }
            const len = lenResult.value;
            offset = lenResult.offset;
            if (offset + len > bytes.length) { return this.failResult(fields, bytes, 'Truncated length-delimited field'); }
            const data = bytes.slice(offset, offset + len);
            // Try to decode as UTF-8 string
            try {
              const str = new TextDecoder('utf-8', { fatal: true }).decode(data);
              value = str;
            } catch {
              value = data;
            }
            offset += len;
            break;
          }
          case 5: { // 32-bit
            if (offset + 4 > bytes.length) { return this.failResult(fields, bytes, 'Truncated 32-bit field'); }
            value = this.readFixed32(bytes, offset);
            offset += 4;
            break;
          }
          default:
            return this.failResult(fields, bytes, `Unknown wire type ${wireType}`);
        }

        fields.push({ fieldNumber, wireType, wireTypeName, value });
      }

      return {
        success: fields.length > 0,
        fields,
        rawHex: this.toHexDump(bytes),
      };
    } catch (error) {
      return {
        success: false,
        fields: [],
        error: error instanceof Error ? error.message : 'Decode failed',
      };
    }
  }

  toHexDump(data: string | Uint8Array): string {
    const bytes = typeof data === 'string' ? this.base64ToBytes(data) : data;
    const lines: string[] = [];

    for (let i = 0; i < bytes.length; i += 16) {
      const hex = Array.from(bytes.slice(i, i + 16))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' ');
      const ascii = Array.from(bytes.slice(i, i + 16))
        .map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.')
        .join('');
      lines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(48, ' ')}  |${ascii}|`);
    }

    return lines.join('\n');
  }

  private base64ToBytes(base64: string): Uint8Array {
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    } catch {
      // Maybe it's already raw data, try hex
      if (/^[0-9a-f]+$/i.test(base64.replace(/\s/g, ''))) {
        const hex = base64.replace(/\s/g, '');
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
          bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
        }
        return bytes;
      }
      // Return as raw UTF-8 bytes
      return new TextEncoder().encode(base64);
    }
  }

  private readVarint(bytes: Uint8Array, offset: number): { value: number; offset: number } | null {
    let result = 0;
    let shift = 0;

    while (offset < bytes.length) {
      const byte = bytes[offset++];
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        return { value: result >>> 0, offset };
      }
      shift += 7;
      if (shift >= 35) return null; // Too many bytes for a 32-bit varint
    }

    return null;
  }

  private readFixed32(bytes: Uint8Array, offset: number): number {
    return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
  }

  private readFixed64(bytes: Uint8Array, offset: number): string {
    const low = this.readFixed32(bytes, offset);
    const high = this.readFixed32(bytes, offset + 4);
    return `0x${(high >>> 0).toString(16).padStart(8, '0')}${(low >>> 0).toString(16).padStart(8, '0')}`;
  }

  private getWireTypeName(wireType: number): string {
    const names: Record<number, string> = {
      0: 'Varint',
      1: '64-bit',
      2: 'Length-delimited',
      5: '32-bit',
    };
    return names[wireType] || `Unknown(${wireType})`;
  }

  private failResult(fields: ProtobufField[], bytes: Uint8Array, error: string): ProtobufDecodeResult {
    return {
      success: fields.length > 0,
      fields,
      error,
      rawHex: this.toHexDump(bytes),
    };
  }
}
