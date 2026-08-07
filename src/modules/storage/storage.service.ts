import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageClient } from '@supabase/storage-js';
import { randomUUID } from 'node:crypto';

import type { StorageConfig } from '../../config/configuration';
import { ImageOptimizerService } from './image-optimizer.service';
import { sniffImageMimeType, type AllowedImageMimeType } from './image-signature';

/** The subset of a multer file this service needs. */
export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface StoredObject {
  /** Path inside the bucket, e.g. `production/movies/<uuid>.webp`. */
  path: string;
  /** Absolute URL for a browser. */
  url: string;
  /** Bytes actually stored, after optimisation. */
  bytes: number;
  /** Percentage saved versus the uploaded file. */
  savedPercent: number;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly config: StorageConfig;
  private readonly client: StorageClient | null;

  constructor(
    configService: ConfigService,
    private readonly optimizer: ImageOptimizerService,
  ) {
    this.config = configService.getOrThrow<StorageConfig>('storage');

    /**
     * `@supabase/storage-js` rather than the full `@supabase/supabase-js`:
     * this service only ever touches Storage, and the umbrella SDK also spins
     * up Realtime — which needs a native WebSocket (Node 22+) and would crash
     * the whole app at boot on older runtimes. Narrower client, no auth or
     * postgrest surface, nothing to go wrong.
     */
    this.client =
      this.config.isConfigured && this.config.url && this.config.secretKey
        ? new StorageClient(`${this.config.url.replace(/\/+$/, '')}/storage/v1`, {
            apikey: this.config.secretKey,
            Authorization: `Bearer ${this.config.secretKey}`,
          })
        : null;

    if (this.client) {
      this.logger.log(
        `Supabase storage ready — bucket "${this.config.bucket}", folder "${this.config.environmentFolder}/"`,
      );
    } else {
      this.logger.warn(
        'Supabase storage is not configured; image uploads will return 503. Set SUPABASE_URL and SUPABASE_SECRET_KEY to enable.',
      );
    }
  }

  get isEnabled(): boolean {
    return this.client !== null;
  }

  /**
   * Uploads an image and returns its public URL.
   *
   * Objects are keyed `<NODE_ENV>/<folder>/<uuid>.<ext>`:
   *
   *  - the **environment prefix** keeps development, test and production from
   *    colliding when they share a bucket, and makes a stray upload obvious;
   *  - the **UUID name** discards the client's filename entirely, which
   *    removes path traversal, overwrite-by-collision and the whole class of
   *    problems that come from trusting `originalname`;
   *  - the **extension comes from the sniffed content**, not the request.
   */
  async uploadImage(file: UploadedFile, folder: string): Promise<StoredObject> {
    const client = this.requireClient();
    const sourceMimeType = this.validateImage(file);

    // Optimise before uploading: the bucket should only ever hold the version
    // we actually intend to serve.
    const optimized = await this.optimizer.optimize(file.buffer, sourceMimeType);

    const path = this.buildPath(folder, optimized.extension);

    const { error } = await client.from(this.config.bucket).upload(path, optimized.buffer, {
      contentType: optimized.mimeType,
      // Never overwrite: the key is a fresh UUID, so a collision would mean
      // something is badly wrong rather than something we should silently fix.
      upsert: false,
      // Immutable content under a UUID key — safe to cache for a year.
      cacheControl: '31536000',
    });

    if (error) {
      this.logger.error(`Upload to ${path} failed: ${error.message}`);
      throw new ServiceUnavailableException('The image could not be stored. Please try again.');
    }

    const { data } = client.from(this.config.bucket).getPublicUrl(path);

    this.logger.log(
      `Stored ${path} — ${optimized.optimizedBytes}B (-${optimized.savedPercent}% vs upload)`,
    );

    return {
      path,
      url: data.publicUrl,
      bytes: optimized.optimizedBytes,
      savedPercent: optimized.savedPercent,
    };
  }

  /**
   * Maps one of our public URLs back to its object path, or `null` when the
   * URL is not ours.
   *
   * Replacing artwork has to delete the old file, and the only thing stored on
   * the row is a URL. Seeded rows point at picsum, so a blind delete would
   * either fail or — worse with a different provider — remove someone else's
   * object. This makes "is this mine?" an explicit check.
   */
  publicPathOf(url: string | null | undefined): string | null {
    if (!url || !this.config.url) return null;

    const prefix = `${this.config.url.replace(/\/+$/, '')}/storage/v1/object/public/${this.config.bucket}/`;

    return url.startsWith(prefix) ? decodeURIComponent(url.slice(prefix.length)) : null;
  }

  /**
   * Best-effort delete, used to compensate when the database write that should
   * have referenced the object fails. Never throws: the caller is already
   * handling a failure and must not be derailed by a second one.
   */
  async removeQuietly(path: string): Promise<void> {
    if (!this.client) return;

    try {
      const { error } = await this.client.from(this.config.bucket).remove([path]);
      if (error) {
        this.logger.warn(`Orphaned object ${path}: ${error.message}`);
      }
    } catch (cause) {
      this.logger.warn(
        `Orphaned object ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  private validateImage(file: UploadedFile): AllowedImageMimeType {
    if (!file.buffer || file.buffer.length === 0) {
      throw new UnprocessableEntityException('The uploaded file is empty');
    }

    if (file.size > this.config.maxFileSizeBytes) {
      const limitMb = Math.round(this.config.maxFileSizeBytes / (1024 * 1024));
      throw new UnprocessableEntityException(`The image must be ${limitMb}MB or smaller`);
    }

    const sniffed = sniffImageMimeType(file.buffer);

    if (!sniffed) {
      throw new UnprocessableEntityException(
        'The file is not a supported image (JPEG, PNG, WebP or AVIF)',
      );
    }

    // A mismatch means the client mislabelled the payload — deliberately or
    // through a broken uploader. Either way, trust the bytes and reject.
    if (file.mimetype && file.mimetype !== sniffed) {
      this.logger.warn(`Declared ${file.mimetype} but content is ${sniffed}; rejecting`);
      throw new UnprocessableEntityException('The file content does not match its declared type');
    }

    return sniffed;
  }

  private buildPath(folder: string, extension: string): string {
    const safeFolder = folder.replace(/[^a-z0-9-]/gi, '').toLowerCase();
    return `${this.config.environmentFolder}/${safeFolder}/${randomUUID()}.${extension}`;
  }

  private requireClient(): StorageClient {
    if (!this.client) {
      throw new ServiceUnavailableException('Image uploads are not configured on this server');
    }
    return this.client;
  }
}
