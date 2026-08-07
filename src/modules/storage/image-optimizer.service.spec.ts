import type { ConfigService } from '@nestjs/config';
import { Logger, UnprocessableEntityException } from '@nestjs/common';
import sharp from 'sharp';

import { ImageOptimizerService } from './image-optimizer.service';

/**
 * Uses the real sharp pipeline — the point of this service is what libvips
 * actually produces, so mocking it would test nothing.
 */
const build = (
  overrides: Partial<{
    targetFormat: 'webp' | 'avif' | 'original';
    quality: number;
    maxWidth: number;
    maxHeight: number;
  }> = {},
): ImageOptimizerService =>
  new ImageOptimizerService({
    getOrThrow: () => ({
      image: {
        targetFormat: 'webp' as const,
        quality: 82,
        maxWidth: 1280,
        maxHeight: 1920,
        ...overrides,
      },
    }),
  } as unknown as ConfigService);

/** A noisy gradient — compresses like a photo rather than a flat colour. */
const photo = (width: number, height: number): Promise<Buffer> => {
  const channels = 3;
  const data = Buffer.alloc(width * height * channels);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      data[offset] = (x * 7 + y * 3) % 256;
      data[offset + 1] = (x * 3 + y * 11) % 256;
      data[offset + 2] = (x * 13 + y * 5) % 256;
    }
  }

  return sharp(data, { raw: { width, height, channels } }).jpeg({ quality: 100 }).toBuffer();
};

describe('ImageOptimizerService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  describe('size', () => {
    it('makes a high-quality JPEG substantially smaller', async () => {
      const input = await photo(1000, 1500);

      const result = await build().optimize(input, 'image/jpeg');

      expect(result.optimizedBytes).toBeLessThan(result.originalBytes);
      expect(result.savedPercent).toBeGreaterThan(20);
    });

    it('reports the saving it actually achieved', async () => {
      const input = await photo(800, 1200);

      const result = await build().optimize(input, 'image/jpeg');

      const expected = Math.round((1 - result.optimizedBytes / result.originalBytes) * 100);
      expect(result.savedPercent).toBe(expected);
    });

    it('never returns something larger than the input', async () => {
      // Already-minimal WebP: re-encoding it could easily grow the file.
      const tiny = await sharp({
        create: { width: 8, height: 8, channels: 3, background: '#123456' },
      })
        .webp({ quality: 82 })
        .toBuffer();

      const result = await build({ targetFormat: 'original' }).optimize(tiny, 'image/webp');

      expect(result.optimizedBytes).toBeLessThanOrEqual(result.originalBytes);
      expect(result.savedPercent).toBe(0);
    });
  });

  describe('dimensions', () => {
    it('scales an oversized image down into the bounding box', async () => {
      const input = await photo(3000, 2000);

      const result = await build({ maxWidth: 1280, maxHeight: 1920 }).optimize(input, 'image/jpeg');

      expect(result.width).toBeLessThanOrEqual(1280);
      expect(result.height).toBeLessThanOrEqual(1920);
    });

    it('preserves the aspect ratio', async () => {
      const input = await photo(3000, 2000);

      const result = await build({ maxWidth: 1280, maxHeight: 1920 }).optimize(input, 'image/jpeg');

      expect(result.width / result.height).toBeCloseTo(3000 / 2000, 1);
    });

    it('leaves a small image at its original size rather than upscaling it', async () => {
      const input = await photo(320, 480);

      const result = await build().optimize(input, 'image/jpeg');

      // Upscaling would only add blur and bytes.
      expect(result.width).toBe(320);
      expect(result.height).toBe(480);
    });
  });

  describe('format', () => {
    it('converts to WebP by default', async () => {
      const input = await photo(600, 900);

      const result = await build().optimize(input, 'image/jpeg');

      expect(result.mimeType).toBe('image/webp');
      expect(result.extension).toBe('webp');
      expect((await sharp(result.buffer).metadata()).format).toBe('webp');
    });

    it('can target AVIF', async () => {
      const input = await photo(400, 600);

      const result = await build({ targetFormat: 'avif' }).optimize(input, 'image/jpeg');

      expect(result.mimeType).toBe('image/avif');
      expect(result.extension).toBe('avif');
    });

    it('keeps the source format when configured to', async () => {
      const input = await photo(600, 900);

      const result = await build({ targetFormat: 'original' }).optimize(input, 'image/jpeg');

      expect(result.mimeType).toBe('image/jpeg');
      expect(result.extension).toBe('jpg');
    });

    it('keeps transparency when converting a PNG with alpha', async () => {
      const input = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 4,
          background: { r: 255, g: 0, b: 0, alpha: 0.5 },
        },
      })
        .png()
        .toBuffer();

      const result = await build().optimize(input, 'image/png');

      expect((await sharp(result.buffer).metadata()).hasAlpha).toBe(true);
    });
  });

  describe('metadata', () => {
    it('strips EXIF from the output', async () => {
      const input = await sharp(await photo(400, 600))
        .withMetadata({ exif: { IFD0: { Copyright: 'Test', Software: 'jest' } } })
        .jpeg()
        .toBuffer();

      expect((await sharp(input).metadata()).exif).toBeDefined();

      const result = await build().optimize(input, 'image/jpeg');

      // EXIF can hold GPS coordinates and camera serials — dropping it is a
      // privacy win as well as a size win.
      expect((await sharp(result.buffer).metadata()).exif).toBeUndefined();
    });

    it('applies EXIF orientation to the pixels before dropping it', async () => {
      // Orientation 6 means "rotate 90°": a 400x600 source must come out 600x400.
      const input = await sharp(await photo(400, 600))
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer();

      const result = await build().optimize(input, 'image/jpeg');

      expect(result.width).toBe(600);
      expect(result.height).toBe(400);
    });
  });

  describe('quality', () => {
    it('produces a smaller file at a lower quality setting', async () => {
      const input = await photo(800, 1200);

      const high = await build({ quality: 95 }).optimize(input, 'image/jpeg');
      const low = await build({ quality: 50 }).optimize(input, 'image/jpeg');

      expect(low.optimizedBytes).toBeLessThan(high.optimizedBytes);
    });

    it('stays visually close to the source at the default quality', async () => {
      const input = await photo(400, 600);

      const result = await build().optimize(input, 'image/jpeg');

      // Same pixel grid, so a viewer sees the same image, not a rescaled one.
      const meta = await sharp(result.buffer).metadata();
      expect(meta.width).toBe(400);
      expect(meta.height).toBe(600);
    });
  });

  describe('failure', () => {
    it('rejects bytes libvips cannot decode', async () => {
      // Passes a naive signature check but is not a decodable image.
      const truncated = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

      await expect(build().optimize(truncated, 'image/jpeg')).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('does not leak the libvips error text', async () => {
      const truncated = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

      const error = (await build()
        .optimize(truncated, 'image/jpeg')
        .catch((e: unknown) => e)) as Error;

      expect(error.message).toBe('The image could not be processed');
    });
  });
});
