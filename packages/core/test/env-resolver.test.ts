import { describe, it, expect } from 'vitest';
import { EnvResolver, EnvVarMissingError } from '../src/loader/EnvResolver';

describe('EnvResolver', () => {
  it('substitutes ${env:VAR} with OS env value', () => {
    const r = new EnvResolver({ osEnv: { FOO: 'bar' } });
    expect(r.resolveValue('${env:FOO}', 'env.X')).toBe('bar');
  });

  it('passes plain strings through unchanged', () => {
    const r = new EnvResolver({ osEnv: {} });
    expect(r.resolveValue('hello world', 'env.X')).toBe('hello world');
  });

  it('substitutes multiple references in a single string', () => {
    const r = new EnvResolver({ osEnv: { A: '1', B: '2' } });
    expect(r.resolveValue('${env:A}/${env:B}', 'env.X')).toBe('1/2');
  });

  it('substitutes empty string for unset var by default', () => {
    const r = new EnvResolver({ osEnv: {} });
    expect(r.resolveValue('${env:MISSING}', 'env.X')).toBe('');
  });

  it('throws EnvVarMissingError for unset var when strict', () => {
    const r = new EnvResolver({ osEnv: {}, onMissing: 'throw' });
    expect(() => r.resolveValue('${env:MISSING}', 'env.X')).toThrow(EnvVarMissingError);
  });

  it('agent env overrides workspace env when layered', () => {
    const r = new EnvResolver({ osEnv: {} });
    const layered = r.resolveLayered(
      { SHARED: 'workspace', LEFT: 'L' },
      { SHARED: 'agent', RIGHT: 'R' },
    );
    expect(layered).toEqual({ SHARED: 'agent', LEFT: 'L', RIGHT: 'R' });
  });

  it('layering survives env var resolution', () => {
    const r = new EnvResolver({ osEnv: { TOKEN: 'secret' } });
    const layered = r.resolveLayered(
      { API_KEY: '${env:TOKEN}' },
      { EXTRA: 'literal' },
    );
    expect(layered).toEqual({ API_KEY: 'secret', EXTRA: 'literal' });
  });

  it('ignores variable names with lowercase / non-conformant characters', () => {
    const r = new EnvResolver({ osEnv: { lowercase: 'should-not-resolve' } });
    // pattern requires [A-Z_][A-Z0-9_]* — lowercase is left as literal
    expect(r.resolveValue('${env:lowercase}', 'env.X')).toBe('${env:lowercase}');
  });
});
