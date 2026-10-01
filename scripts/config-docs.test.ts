/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CONTROL_NAMES, readConfig, resolveControls, runtimeControls } from './update-data';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const file = JSON.parse(read('scripts/update-data.config.json'));
const workflow = read('.github/workflows/update-data.yml');
const inputsBlock = workflow.slice(workflow.indexOf('    inputs:'), workflow.indexOf('\npermissions:'));
const inputNames = [...inputsBlock.matchAll(/^      (\w+):$/gm)].map((m) => m[1]);

describe('resolveControls layering', () => {
  test('precedence: file < advanced < nonblank input < environment (brand alias wins)', () => {
    const c = resolveControls({ CONCURRENCY: 2, TICKERS: 'AGEM' }, { CONCURRENCY: 3, TICKERS: 'SGOL' }, { CONCURRENCY: '4', TICKERS: '' }, { ABERDEEN_CONCURRENCY: '5', CONCURRENCY: '6' });
    expect(c).toEqual({ CONCURRENCY: '5', TICKERS: 'SGOL' });
    expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
  });

  test('blank input inherits the file value; advanced can clear a key deliberately', () => {
    expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
    expect(resolveControls({ TICKERS: 'AGEM' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
  });

  test('scheduled path (empty inputs and advanced) equals the config defaults', () => {
    const c = resolveControls(file, {}, {}, {});
    expect(c).toEqual(Object.fromEntries(Object.entries(file).map(([k, v]) => [k, String(v)])));
    for (const value of Object.values(c)) expect(typeof value).toBe('string');
  });

  test('invalid JSON shapes, unknown keys, non-scalars and control characters are rejected', () => {
    for (const bad of [{ UNKNOWN: 1 }, { TICKERS: ['AGEM'] }, { TICKERS: { a: 1 } }, { TICKERS: null }, null, [], 'x', 1]) {
      expect(() => resolveControls(bad as any)).toThrow();
    }
    expect(() => resolveControls({}, { SEC_UA: 'x\nEVIL=yes' })).toThrow();
    expect(() => resolveControls({}, {}, { SEC_UA: 'x\rfoo' })).toThrow();
    expect(() => resolveControls({}, {}, {}, { ABERDEEN_SEC_UA: 'x\0bad' })).toThrow();
    expect(() => resolveControls({}, [] as any)).toThrow();
    expect(() => JSON.parse('{oops')).toThrow();
  });

  test('per-control validation is kept', () => {
    for (const bad of [{ CONCURRENCY: 0 }, { MAX_RETRIES: -1 }, { MAX_FETCHES: 1.5 }, { REQUEST_SLEEP: '-1' }, { HISTORY_RANGE: 'oops' }, { VERBOSE: 'maybe' }, { AUM: '1:2:3' }, { TER: 'a:b' }]) {
      expect(() => resolveControls(bad)).toThrow();
    }
  });
});

describe('aberdeen defaults and docs parity', () => {
  test('provider-specific default values', () => {
    const config = readConfig(resolveControls(file));
    expect(config.tickers).toEqual([]);
    expect(config.maxFetches).toBe(0);
    expect(config.concurrency).toBe(2);
    expect(file.REQUEST_SLEEP).toBe('1');
    expect(file.HISTORY_RANGE).toBe('max');
    expect(file.HOLDINGS_PAGE_SIZE).toBe('250');
    expect(file.HISTORY_PAGE_SIZE).toBe('1000');
    expect(file.EDGAR_FALLBACK).toBe('true');
    expect(file.SKIP_ABERDEEN).toBe('false');
    expect(file.SEC_UA).not.toMatch(/@/);
  });

  test('config values are strings and keys equal CONTROL_NAMES', () => {
    for (const value of Object.values(file)) expect(typeof value).toBe('string');
    expect(Object.keys(file).sort()).toEqual([...CONTROL_NAMES].sort());
  });

  test('README rows and --help cover every control', async () => {
    const doc = read('README.md');
    for (const name of CONTROL_NAMES) {
      expect(doc).toContain('`' + name + '`');
    }
    expect(doc).toContain('scripts/update-data.config.json');
    const child = Bun.spawn([process.execPath, new URL('./update-data.ts', import.meta.url).pathname, '--help'], { stdout: 'pipe', stderr: 'pipe' });
    const help = await new Response(child.stdout).text();
    await child.exited;
    for (const name of CONTROL_NAMES) expect(help).toContain(name);
  });

  test('runtimeControls reads the file and lets the environment win', async () => {
    expect((await runtimeControls({})).CONCURRENCY).toBe(file.CONCURRENCY);
    expect((await runtimeControls({ CONCURRENCY: '7' })).CONCURRENCY).toBe('7');
  });
});

describe('workflow', () => {
  test('inputs: at most 25, advanced defaults to {}, every individual input is a control', () => {
    expect(inputNames.length).toBeLessThanOrEqual(25);
    expect(inputNames).toContain('advanced');
    expect(inputsBlock).toMatch(/advanced:[\s\S]*?default: '\{\}'/);
    for (const name of inputNames.filter((n) => n !== 'advanced')) expect(CONTROL_NAMES).toContain(name.toUpperCase() as any);
    expect(inputNames).toContain('concurrency');
    expect(inputNames).toContain('tickers');
  });

  test('schedule, fixed output dir and no direct inputs interpolation', () => {
    expect(workflow).toContain("cron: '0 0 * * 0'");
    expect(workflow).not.toMatch(/^  push:/m);
    expect(workflow).toContain('toJSON(inputs)');
    expect(workflow).not.toMatch(/\$\{\{\s*(github\.event\.)?inputs\./);
    expect(workflow).not.toContain('OUTPUT_DIR');
    expect(workflow).toContain('git add api/aberdeen\n          if git diff --cached --quiet -- api/aberdeen');
    expect([...workflow.matchAll(/git add (\S+)/g)].map((m) => m[1])).toEqual(['api/aberdeen']);
  });

  test('protected SEC_UA variable wins only when nonblank and is never an input', () => {
    expect(workflow).toContain('PROTECTED_SEC_UA: ${{ vars.SEC_UA }}');
    expect(inputNames).not.toContain('sec_ua');
    expect(workflow).toContain('if ((process.env.PROTECTED_SEC_UA ?? "").trim())');
    const protectedWins = resolveControls(file, { SEC_UA: 'advanced' }, {}, { SEC_UA: 'protected' });
    expect(protectedWins.SEC_UA).toBe('protected');
    expect(resolveControls(file, { SEC_UA: 'advanced' }, {}, {}).SEC_UA).toBe('advanced');
  });
});
