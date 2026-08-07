import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp, { type OutputInfo, type Sharp } from 'sharp';

import type { ImageConfig, StorageConfig } from '../../config/configuration';
import type { AllowedImageMimeType } from './image-signature';

export interface OptimizedImage {
  buffer: Buffer;
  mimeType: AllowedImageMimeType;
  extension: string;
  width: number;
  height: number;
  originalBytes: number;
  optimizedBytes: number;
  /** Percentage saved, 0 when the original was already smaller. */
  savedPercent: number;
}

const MIME_BY_FORMAT: Record<string, AllowedImageMimeType> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
};

const EXTENSION_BY_FORMAT: Record<string, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
};

/**
 * Re-encodes uploads so stored artwork is small without looking worse.
 *
 * Four things happen, and each one earns its place:
 *
 *  1. **Auto-rotate.** EXIF orientation is applied to the pixels *before*
 *     metadata is dropped, otherwise stripping it would silently turn photos
 *     sideways.
 *  2. **Resize down to a bounding box.** A 6000px poster is pure waste: it is
 *     never displayed above ~1280px, and the bytes cost on every request.
 *     `withoutEnlargement` means a small source is left alone rather than
 *     upscaled into blur.
 *  3. **Strip metadata.** EXIF/ICC/thumbnails are often tens of kilobytes and
 *     can carry GPS coordinates and camera serials — a size win and a privacy
 *     win at once.
 *  4. **Re-encode.** WebP at q82 is the usual visually-lossless point.
 *
 * Re-encoding is also a security control: the output is pixels decoded and
 * written afresh by libvips, so any payload smuggled inside the original
 * container — polyglot files, scripts hidden in metadata — does not survive.
 */
@Injectable()
export class ImageOptimizerService {
  private readonly logger = new Logger(ImageOptimizerService.name);
  private readonly config: ImageConfig;

  constructor(configService: ConfigService) {
    this.config = configService.getOrThrow<StorageConfig>('storage').image;

    // libvips caches decoded images between calls; in a server that is memory
    // held for no benefit, since every upload is a different file.
    sharp.cache(false);
  }

  async optimize(input: Buffer, sourceMimeType: AllowedImageMimeType): Promise<OptimizedImage> {
    const originalBytes = input.length;

    let pipeline = sharp(input, { failOn: 'error' }).rotate().resize({
      width: this.config.maxWidth,
      height: this.config.maxHeight,
      fit: 'inside',
      withoutEnlargement: true,
    });

    const targetFormat = this.resolveFormat(sourceMimeType);
    pipeline = this.encode(pipeline, targetFormat);

    let output: { data: Buffer; info: OutputInfo };

    try {
      const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
      output = { data, info };
    } catch (cause) {
      // Reached only if the bytes passed the signature check but libvips still
      // cannot decode them — i.e. a corrupt or truncated file.
      this.logger.warn(
        `Could not decode upload: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      throw new UnprocessableEntityException('The image could not be processed');
    }

    // Re-encoding an already-optimised file can make it bigger. Never ship a
    // "optimisation" that costs the user bytes.
    if (output.data.length >= originalBytes && targetFormat === this.formatOf(sourceMimeType)) {
      const metadata = await sharp(input).metadata();

      this.logger.log(
        `Kept original (${originalBytes}B); re-encode would have been ${output.data.length}B`,
      );

      return {
        buffer: input,
        mimeType: sourceMimeType,
        extension: EXTENSION_BY_FORMAT[this.formatOf(sourceMimeType)] ?? 'bin',
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
        originalBytes,
        optimizedBytes: originalBytes,
        savedPercent: 0,
      };
    }

    const optimizedBytes = output.data.length;
    const savedPercent =
      originalBytes > 0 ? Math.max(0, Math.round((1 - optimizedBytes / originalBytes) * 100)) : 0;

    this.logger.log(
      `Optimised ${originalBytes}B -> ${optimizedBytes}B (-${savedPercent}%), ` +
        `${output.info.width}x${output.info.height} ${targetFormat}`,
    );

    return {
      buffer: output.data,
      mimeType: MIME_BY_FORMAT[targetFormat] ?? sourceMimeType,
      extension: EXTENSION_BY_FORMAT[targetFormat] ?? 'bin',
      width: output.info.width,
      height: output.info.height,
      originalBytes,
      optimizedBytes,
      savedPercent,
    };
  }

  private resolveFormat(sourceMimeType: AllowedImageMimeType): string {
    if (this.config.targetFormat === 'original') return this.formatOf(sourceMimeType);
    return this.config.targetFormat;
  }

  private formatOf(mimeType: AllowedImageMimeType): string {
    return mimeType === 'image/jpeg' ? 'jpeg' : mimeType.replace('image/', '');
  }

  private encode(pipeline: Sharp, format: string): Sharp {
    const { quality } = this.config;

    switch (format) {
      case 'webp':
        // `effort: 5` buys a few more percent for a little CPU; `smartSubsample`
        // keeps chroma detail, which matters on title text over artwork.
        return pipeline.webp({ quality, effort: 5, smartSubsample: true });

      case 'avif':
        return pipeline.avif({ quality, effort: 4, chromaSubsampling: '4:2:0' });

      case 'png':
        // PNG is lossless; the win comes from palette quantisation and a
        // higher compression level, not from a quality knob.
        return pipeline.png({ compressionLevel: 9, palette: true, effort: 7 });

      case 'jpeg':
      default:
        // mozjpeg is meaningfully smaller than libjpeg at the same quality.
        return pipeline.jpeg({ quality, mozjpeg: true, progressive: true });
    }
  }
}
