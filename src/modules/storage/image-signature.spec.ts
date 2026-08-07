import { extensionFor, sniffImageMimeType } from './image-signature';

/** Real magic bytes, padded to the 12-byte minimum the sniffer needs. */
const pad = (bytes: number[]): Buffer => Buffer.concat([Buffer.from(bytes), Buffer.alloc(16)]);

const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
  Buffer.alloc(8),
]);
const AVIF = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x20]),
  Buffer.from('ftyp', 'ascii'),
  Buffer.from('avif', 'ascii'),
  Buffer.alloc(8),
]);

describe('sniffImageMimeType', () => {
  it.each([
    ['JPEG', JPEG, 'image/jpeg'],
    ['PNG', PNG, 'image/png'],
    ['WebP', WEBP, 'image/webp'],
    ['AVIF', AVIF, 'image/avif'],
  ])('recognises %s', (_label, buffer, expected) => {
    expect(sniffImageMimeType(buffer)).toBe(expected);
  });

  it('rejects a buffer too short to identify', () => {
    expect(sniffImageMimeType(Buffer.from([0xff, 0xd8]))).toBeNull();
  });

  it('rejects plain text', () => {
    expect(sniffImageMimeType(Buffer.from('hello world, definitely not an image'))).toBeNull();
  });

  it('rejects an executable masquerading as an image', () => {
    // ELF header — the exact thing a mimetype-only check would wave through.
    expect(sniffImageMimeType(pad([0x7f, 0x45, 0x4c, 0x46]))).toBeNull();
  });

  it('rejects an SVG, which is script-capable and not in the allow-list', () => {
    expect(
      sniffImageMimeType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
    ).toBeNull();
  });

  it('rejects RIFF that is not WebP (e.g. a WAV)', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from('WAVE', 'ascii'),
      Buffer.alloc(8),
    ]);

    expect(sniffImageMimeType(wav)).toBeNull();
  });

  it('rejects an ISO-BMFF container that is not AVIF (e.g. an MP4)', () => {
    const mp4 = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x20]),
      Buffer.from('ftyp', 'ascii'),
      Buffer.from('isom', 'ascii'),
      Buffer.alloc(8),
    ]);

    expect(sniffImageMimeType(mp4)).toBeNull();
  });
});

describe('extensionFor', () => {
  it('maps each supported type to its canonical extension', () => {
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('image/png')).toBe('png');
    expect(extensionFor('image/webp')).toBe('webp');
    expect(extensionFor('image/avif')).toBe('avif');
  });
});

export { JPEG, PNG, WEBP, AVIF };
