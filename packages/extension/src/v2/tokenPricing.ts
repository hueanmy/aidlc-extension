/**
 * Pricing table + cost calc, shared between the status-bar monitor, the
 * per-step epic attribution, and the suggest-engine. Mirrors
 * https://github.com/emtyty/claude-token-monitor (monitor.py:PRICING).
 *
 * Per 1M tokens, USD. Prefix-substring match against the model name in
 * the JSONL `message.model` field.
 */
export interface ModelPrice {
  in: number;
  out: number;
  cr: number;
  cw: number;
}

export const PRICING: Record<string, ModelPrice> = {
  'claude-opus-4':     { in: 15.0, out: 75.0, cr: 1.50, cw: 18.75 },
  'claude-sonnet-4':   { in:  3.0, out: 15.0, cr: 0.30, cw:  3.75 },
  'claude-haiku-4':    { in:  1.0, out:  5.0, cr: 0.10, cw:  1.25 },
  'claude-3-5-sonnet': { in:  3.0, out: 15.0, cr: 0.30, cw:  3.75 },
  'claude-3-5-haiku':  { in:  0.8, out:  4.0, cr: 0.08, cw:  1.00 },
  'claude-3-opus':     { in: 15.0, out: 75.0, cr: 1.50, cw: 18.75 },
  'claude-3-haiku':    { in: 0.25, out: 1.25, cr: 0.03, cw:  0.30 },
};

export const DEFAULT_PRICE: ModelPrice = { in: 3.0, out: 15.0, cr: 0.30, cw: 3.75 };

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export function modelPrice(model: string): ModelPrice {
  const m = (model || '').toLowerCase();
  for (const [prefix, price] of Object.entries(PRICING)) {
    if (m.includes(prefix)) { return price; }
  }
  return DEFAULT_PRICE;
}

export function calcCost(usage: Usage, model: string): number {
  const p = modelPrice(model);
  return (
    usage.input_tokens * p.in / 1_000_000 +
    usage.output_tokens * p.out / 1_000_000 +
    usage.cache_read_input_tokens * p.cr / 1_000_000 +
    usage.cache_creation_input_tokens * p.cw / 1_000_000
  );
}
