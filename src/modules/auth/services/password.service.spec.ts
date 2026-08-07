import { type ConfigService } from '@nestjs/config';

import { PasswordService } from './password.service';

// bcrypt is intentionally slow; the lowest allowed cost keeps the suite quick
// while still exercising the real algorithm.
const AUTH_CONFIG = { bcryptRounds: 10 };

describe('PasswordService', () => {
  let service: PasswordService;

  beforeEach(async () => {
    service = new PasswordService({
      getOrThrow: () => AUTH_CONFIG,
    } as unknown as ConfigService);

    await service.onModuleInit();
  });

  it('produces a bcrypt digest, not the plaintext', async () => {
    const hash = await service.hash('Str0ng!Passw0rd');

    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(hash).not.toContain('Str0ng!Passw0rd');
  });

  it('salts: the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([
      service.hash('same-password'),
      service.hash('same-password'),
    ]);

    expect(a).not.toBe(b);
  });

  it('verifies a correct password', async () => {
    const hash = await service.hash('Str0ng!Passw0rd');

    await expect(service.compare('Str0ng!Passw0rd', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await service.hash('Str0ng!Passw0rd');

    await expect(service.compare('wrong', hash)).resolves.toBe(false);
  });

  it('rejects a near-miss', async () => {
    const hash = await service.hash('Str0ng!Passw0rd');

    await expect(service.compare('Str0ng!Passw0r', hash)).resolves.toBe(false);
  });

  it('always resolves false for the dummy comparison', async () => {
    await expect(service.compareWithDummy('anything')).resolves.toBe(false);
  });

  it('spends comparable time on the dummy path', async () => {
    const hash = await service.hash('Str0ng!Passw0rd');

    const realStart = process.hrtime.bigint();
    await service.compare('wrong-password', hash);
    const realMs = Number(process.hrtime.bigint() - realStart) / 1_000_000;

    const dummyStart = process.hrtime.bigint();
    await service.compareWithDummy('wrong-password');
    const dummyMs = Number(process.hrtime.bigint() - dummyStart) / 1_000_000;

    // Same order of magnitude is the property that matters; exact parity is
    // impossible to assert reliably on shared CI hardware.
    expect(dummyMs).toBeGreaterThan(realMs / 5);
    expect(dummyMs).toBeLessThan(realMs * 5);
  });
});
