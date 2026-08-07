import { Transform } from 'class-transformer';

/**
 * Parses the string forms a boolean arrives in over HTTP.
 *
 * `enableImplicitConversion` cannot be trusted for booleans: it applies
 * `Boolean(value)`, and every non-empty string is truthy — so `"false"`
 * becomes `true`. Any boolean that can reach us as text (query string,
 * `multipart/form-data`, an HTML checkbox sending `"on"`) needs this instead.
 *
 * Unrecognised input is passed through untouched so `@IsBoolean()` can reject
 * it with a 400, rather than being silently coerced into something plausible.
 */
export const parseBoolean = (value: unknown): unknown => {
  if (typeof value === 'boolean') return value;

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (['true', '1', 'on', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'off', 'no', ''].includes(normalized)) return false;
  }

  if (value === 1) return true;
  if (value === 0) return false;

  return value;
};

/** Use on every boolean DTO field that is not JSON-only. */
export const ToBoolean = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) => parseBoolean(value));
