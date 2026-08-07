// `plainToInstance` reads design-time metadata; this spec never touches Nest,
// which is what normally pulls the polyfill in.
import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IsBoolean, IsOptional } from 'class-validator';

import { parseBoolean, ToBoolean } from './to-boolean.transform';

class Sample {
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  flag?: boolean;
}

/** Mirrors the global pipe exactly — see the note in main.ts. */
const parse = (raw: unknown): { value: unknown; valid: boolean } => {
  const instance = plainToInstance(Sample, { flag: raw }, { enableImplicitConversion: false });
  return { value: instance.flag, valid: validateSync(instance).length === 0 };
};

describe('parseBoolean', () => {
  it('passes real booleans through', () => {
    expect(parseBoolean(true)).toBe(true);
    expect(parseBoolean(false)).toBe(false);
  });

  it.each(['true', 'TRUE', ' True ', '1', 'on', 'yes'])('reads %p as true', (raw) => {
    expect(parseBoolean(raw)).toBe(true);
  });

  it.each(['false', 'FALSE', ' False ', '0', 'off', 'no', ''])('reads %p as false', (raw) => {
    expect(parseBoolean(raw)).toBe(false);
  });

  it('handles numeric 1 and 0', () => {
    expect(parseBoolean(1)).toBe(true);
    expect(parseBoolean(0)).toBe(false);
  });

  it('leaves anything else alone so @IsBoolean can reject it', () => {
    expect(parseBoolean('maybe')).toBe('maybe');
    expect(parseBoolean(42)).toBe(42);
    expect(parseBoolean(null)).toBeNull();
  });
});

describe('@ToBoolean through the validation pipeline', () => {
  it('REGRESSION: "false" from multipart must not become true', () => {
    // `enableImplicitConversion` alone applies Boolean("false") === true, which
    // silently published movies that were submitted as drafts.
    expect(parse('false')).toEqual({ value: false, valid: true });
  });

  it('accepts "true" from multipart', () => {
    expect(parse('true')).toEqual({ value: true, valid: true });
  });

  it("accepts an HTML checkbox's default 'on'", () => {
    expect(parse('on')).toEqual({ value: true, valid: true });
  });

  it('treats an omitted field as absent, not false', () => {
    const instance = plainToInstance(Sample, {}, { enableImplicitConversion: false });

    expect(instance.flag).toBeUndefined();
    expect(validateSync(instance)).toHaveLength(0);
  });

  it('rejects a value it cannot interpret', () => {
    expect(parse('maybe').valid).toBe(false);
  });
});
