import type { ConfigService } from '@nestjs/config';
import { Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { StorageClient } from '@supabase/storage-js';

import { type ImageOptimizerService } from './image-optimizer.service';
import { StorageService, type UploadedFile } from './storage.service';

jest.mock('@supabase/storage-js', () => ({ StorageClient: jest.fn() }));

const StorageClientMock = StorageClient as unknown as jest.Mock;

const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);

const buildFile = (overrides: Partial<UploadedFile> = {}): UploadedFile => ({
  buffer: JPEG_BYTES,
  originalname: 'poster.jpg',
  mimetype: 'image/jpeg',
  size: JPEG_BYTES.length,
  ...overrides,
});

interface SupabaseStub {
  upload: jest.Mock;
  getPublicUrl: jest.Mock;
  remove: jest.Mock;
}

const buildSupabase = (): SupabaseStub => {
  const stub: SupabaseStub = {
    upload: jest.fn().mockResolvedValue({ error: null }),
    getPublicUrl: jest.fn((path: string) => ({
      data: { publicUrl: `https://cdn.test/storage/v1/object/public/movieflix/${path}` },
    })),
    remove: jest.fn().mockResolvedValue({ error: null }),
  };

  StorageClientMock.mockImplementation(() => ({ from: jest.fn(() => stub) }));

  return stub;
};

const build = (
  overrides: Partial<{
    url: string | undefined;
    secretKey: string | undefined;
    environmentFolder: string;
    maxFileSizeBytes: number;
  }> = {},
): StorageService => {
  const config = {
    url: 'https://project.supabase.co',
    secretKey: 'service-role-key',
    bucket: 'movieflix',
    maxFileSizeBytes: 5 * 1024 * 1024,
    environmentFolder: 'development',
    ...overrides,
  };

  // A pass-through optimizer keeps these tests about *storage*; the real
  // re-encoding is covered in image-optimizer.service.spec.ts.
  const optimizer = {
    optimize: jest.fn((buffer: Buffer, mimeType: string) =>
      Promise.resolve({
        buffer,
        mimeType,
        extension: mimeType === 'image/png' ? 'png' : 'jpg',
        width: 1,
        height: 1,
        originalBytes: buffer.length,
        optimizedBytes: buffer.length,
        savedPercent: 0,
      }),
    ),
  } as unknown as ImageOptimizerService;

  return new StorageService(
    {
      getOrThrow: () => ({ ...config, isConfigured: Boolean(config.url && config.secretKey) }),
    } as unknown as ConfigService,
    optimizer,
  );
};

describe('StorageService', () => {
  let supabase: SupabaseStub;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    supabase = buildSupabase();
  });

  describe('environment folders', () => {
    it('prefixes every object with the environment', async () => {
      const service = build({ environmentFolder: 'production' });

      const stored = await service.uploadImage(buildFile(), 'movies');

      expect(stored.path).toMatch(/^production\/movies\//);
    });

    it('keeps environments from colliding in a shared bucket', async () => {
      const dev = await build({ environmentFolder: 'development' }).uploadImage(
        buildFile(),
        'movies',
      );
      const prod = await build({ environmentFolder: 'production' }).uploadImage(
        buildFile(),
        'movies',
      );

      expect(dev.path.split('/')[0]).toBe('development');
      expect(prod.path.split('/')[0]).toBe('production');
    });

    it('nests the caller folder under the environment', async () => {
      const stored = await build().uploadImage(buildFile(), 'movies');

      expect(stored.path).toMatch(/^development\/movies\/[0-9a-f-]{36}\.jpg$/);
    });

    it('sanitises the folder so it cannot escape the prefix', async () => {
      const stored = await build().uploadImage(buildFile(), '../../etc');

      expect(stored.path).toMatch(/^development\/etc\//);
      expect(stored.path).not.toContain('..');
    });
  });

  describe('object naming', () => {
    it('discards the client filename entirely', async () => {
      const stored = await build().uploadImage(
        buildFile({ originalname: '../../../etc/passwd.jpg' }),
        'movies',
      );

      expect(stored.path).not.toContain('passwd');
      expect(stored.path).not.toContain('..');
    });

    it('derives the extension from the content, not the filename', async () => {
      const stored = await build().uploadImage(
        buildFile({ buffer: PNG_BYTES, mimetype: 'image/png', originalname: 'poster.jpg' }),
        'movies',
      );

      expect(stored.path.endsWith('.png')).toBe(true);
    });

    it('never reuses a key', async () => {
      const service = build();
      const first = await service.uploadImage(buildFile(), 'movies');
      const second = await service.uploadImage(buildFile(), 'movies');

      expect(first.path).not.toBe(second.path);
    });
  });

  describe('upload', () => {
    it('returns the public URL', async () => {
      const stored = await build().uploadImage(buildFile(), 'movies');

      expect(stored.url).toBe(`https://cdn.test/storage/v1/object/public/movieflix/${stored.path}`);
    });

    it('sends the sniffed content type and refuses to overwrite', async () => {
      await build().uploadImage(buildFile(), 'movies');

      expect(supabase.upload).toHaveBeenCalledWith(
        expect.any(String),
        JPEG_BYTES,
        expect.objectContaining({ contentType: 'image/jpeg', upsert: false }),
      );
    });

    it('maps a storage failure to 503, not 500', async () => {
      supabase.upload.mockResolvedValue({ error: { message: 'bucket not found' } });

      await expect(build().uploadImage(buildFile(), 'movies')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('does not leak the provider error to the caller', async () => {
      supabase.upload.mockResolvedValue({ error: { message: 'bucket movieflix does not exist' } });

      const error = (await build()
        .uploadImage(buildFile(), 'movies')
        .catch((e: unknown) => e)) as Error;

      expect(error.message).not.toContain('bucket movieflix');
    });
  });

  describe('validation', () => {
    it('rejects a payload that is not an image', async () => {
      await expect(
        build().uploadImage(buildFile({ buffer: Buffer.from('not an image at all') }), 'movies'),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('rejects content that contradicts its declared type', async () => {
      // A PNG announced as a JPEG: the bytes win.
      await expect(
        build().uploadImage(buildFile({ buffer: PNG_BYTES, mimetype: 'image/jpeg' }), 'movies'),
      ).rejects.toThrow(/does not match its declared type/);
    });

    it('rejects an oversized file', async () => {
      await expect(
        build({ maxFileSizeBytes: 10 }).uploadImage(buildFile({ size: 999_999 }), 'movies'),
      ).rejects.toThrow(/1MB or smaller|0MB or smaller/);
    });

    it('rejects an empty file', async () => {
      await expect(
        build().uploadImage(buildFile({ buffer: Buffer.alloc(0), size: 0 }), 'movies'),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('never reaches the network for an invalid file', async () => {
      await build()
        .uploadImage(buildFile({ buffer: Buffer.from('nope') }), 'movies')
        .catch(() => undefined);

      expect(supabase.upload).not.toHaveBeenCalled();
    });
  });

  describe('when Supabase is not configured', () => {
    it('still constructs, so the API boots', () => {
      expect(() => build({ url: undefined, secretKey: undefined })).not.toThrow();
    });

    it('reports itself disabled', () => {
      expect(build({ secretKey: undefined }).isEnabled).toBe(false);
    });

    it('answers 503 on upload rather than crashing', async () => {
      await expect(
        build({ url: undefined, secretKey: undefined }).uploadImage(buildFile(), 'movies'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('makes removeQuietly a no-op', async () => {
      await expect(
        build({ url: undefined, secretKey: undefined }).removeQuietly('x/y.jpg'),
      ).resolves.toBeUndefined();
    });
  });

  describe('publicPathOf', () => {
    it('recovers the object path from one of our URLs', () => {
      const service = build();

      expect(
        service.publicPathOf(
          'https://project.supabase.co/storage/v1/object/public/movieflix/development/movies/a.webp',
        ),
      ).toBe('development/movies/a.webp');
    });

    it('returns null for a third-party URL', () => {
      // Seeded rows point at picsum; that object is not ours to delete.
      expect(build().publicPathOf('https://picsum.photos/seed/dune/400/600')).toBeNull();
    });

    it('returns null for a different bucket on the same host', () => {
      expect(
        build().publicPathOf(
          'https://project.supabase.co/storage/v1/object/public/other-bucket/x.webp',
        ),
      ).toBeNull();
    });

    it('handles null and undefined', () => {
      expect(build().publicPathOf(null)).toBeNull();
      expect(build().publicPathOf(undefined)).toBeNull();
    });

    it('decodes a percent-encoded path', () => {
      expect(
        build().publicPathOf(
          'https://project.supabase.co/storage/v1/object/public/movieflix/dev/a%20b.webp',
        ),
      ).toBe('dev/a b.webp');
    });

    it('returns null when storage is not configured', () => {
      expect(
        build({ url: undefined, secretKey: undefined }).publicPathOf(
          'https://project.supabase.co/storage/v1/object/public/movieflix/x.webp',
        ),
      ).toBeNull();
    });
  });

  describe('removeQuietly', () => {
    it('deletes the object', async () => {
      await build().removeQuietly('development/movies/a.jpg');

      expect(supabase.remove).toHaveBeenCalledWith(['development/movies/a.jpg']);
    });

    it('swallows a provider error — the caller is already failing', async () => {
      supabase.remove.mockResolvedValue({ error: { message: 'not found' } });

      await expect(build().removeQuietly('a.jpg')).resolves.toBeUndefined();
    });

    it('swallows a thrown error too', async () => {
      supabase.remove.mockRejectedValue(new Error('network down'));

      await expect(build().removeQuietly('a.jpg')).resolves.toBeUndefined();
    });
  });
});
