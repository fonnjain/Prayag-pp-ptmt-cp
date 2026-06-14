// models.js — the ONLY place an Anthropic model is chosen.
// Tiering applies to LANGUAGE calls only (report narrative + data sanity).
// It never changes the data path; numbers are identical on either tier.
const FAST = process.env.ANTHROPIC_MODEL_FAST || 'claude-sonnet-4-6';
const DEEP = process.env.ANTHROPIC_MODEL_DEEP || 'claude-opus-4-8';
const MAX_FAST = parseInt(process.env.MAX_TOKENS_FAST || '1500', 10);
const MAX_DEEP = parseInt(process.env.MAX_TOKENS_DEEP || '4000', 10);
const DEEP_PERIODS = new Set(['monthly', 'quarterly', 'fiscal_year']);

function selectModel(periodType, { override = null, board = false } = {}) {
  let tier;
  if (override === true) tier = 'deep';            // sanity check passes this
  else if (override === false) tier = 'fast';
  else if (board || DEEP_PERIODS.has((periodType || '').toLowerCase())) tier = 'deep';
  else tier = 'fast';
  return tier === 'deep'
    ? { model: DEEP, maxTokens: MAX_DEEP, tier }
    : { model: FAST, maxTokens: MAX_FAST, tier };
}

// Retry once on FAST if DEEP errors; report the downgrade via the callback.
async function callWithFallback(client, sel, payload, recordDowngrade) {
  try {
    return await client.messages.create({ model: sel.model, max_tokens: sel.maxTokens, ...payload });
  } catch (e) {
    if (sel.tier === 'deep') {
      if (recordDowngrade) recordDowngrade(sel.model);
      return await client.messages.create({ model: FAST, max_tokens: MAX_FAST, ...payload });
    }
    throw e;
  }
}

module.exports = { selectModel, callWithFallback };
