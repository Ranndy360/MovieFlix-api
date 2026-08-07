/**
 * Hard limits applied by multer, *before* the request body is buffered.
 *
 * `StorageService` re-checks the size, but that check runs only after the whole
 * file is already in memory — too late to matter. This is the limit that
 * actually protects the process, so it must live at the interceptor.
 *
 * Read from `process.env` because `@UseInterceptors()` is evaluated when the
 * class is defined, before any DI container exists. The value is still
 * validated in `env.validation.ts`, so a malformed number fails the boot.
 */
const megabytes = (): number => {
  const parsed = Number(process.env.UPLOAD_MAX_FILE_SIZE_MB);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 50 ? parsed : 10;
};

export const MAX_UPLOAD_BYTES = megabytes() * 1024 * 1024;

/** Passed to `FileInterceptor`. One file, size-capped, nothing else accepted. */
export const SINGLE_IMAGE_UPLOAD = {
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    // Multipart text fields are DTO fields; this bounds a pathological form.
    fields: 32,
  },
} as const;
