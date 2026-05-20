/**
 * Medical abbreviation normalizer.
 *
 * Strategy:
 *   1. Static map of regional (e.g. Vietnamese clinical shorthand) and international medical abbreviations
 *   2. UMLS-backed lookup: search the Zilliz collection for UMLS atoms whose STR
 *      matches the abbreviation token (exact match on metadata->str, case-insensitive)
 *   3. In-memory cache for UMLS lookups (process-local, TTL 24h)
 *
 * Returns the normalized question string with abbreviations expanded inline.
 */
const logger = require('../utils/logger');
const vectorStore = require('./vectorStore.service');

const CACHE_PREFIX = 'abbr';
const CACHE_TTL_MS = 86400 * 1000; // 24h

/** @type {Map<string, { value: string; expiresAt: number }>} */
const umlsCache = new Map();

function cacheGet(key) {
  const row = umlsCache.get(key);
  if (!row) return undefined;
  if (Date.now() > row.expiresAt) {
    umlsCache.delete(key);
    return undefined;
  }
  return row.value;
}

function cacheSet(key, value) {
  umlsCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

const STATIC_ABBREVIATIONS = {
  'HA':   'blood pressure',
  'COPD': 'chronic obstructive pulmonary disease',
  'CHF':  'congestive heart failure',
  'MI':   'myocardial infarction',
  'CVA':  'cerebrovascular accident',
  'TB':   'tuberculosis',
  'HIV':  'human immunodeficiency virus',
  'BMI':  'body mass index',
  'ECG':  'electrocardiogram',
  'EKG':  'electrocardiogram',
  'CT':   'computed tomography',
  'MRI':  'magnetic resonance imaging',
  'CBC':  'complete blood count',
  'BUN':  'blood urea nitrogen',
  'ICU':  'intensive care unit',
  'OTC':  'over-the-counter medicine',
  'Rx':   'prescription',
  'Dx':   'diagnosis',
  'Tx':   'treatment',
  'Sx':   'symptoms',
  'Hx':   'medical history',
  'BP':   'blood pressure',
  'HR':   'heart rate',
  'RR':   'respiratory rate',
  'SpO2': 'oxygen saturation',
  'GI':   'gastrointestinal',
  'UTI':  'urinary tract infection',
  'DVT':  'deep vein thrombosis',
  'PE':   'pulmonary embolism',
  'GERD': 'gastroesophageal reflux disease',
  'NSAID': 'nonsteroidal anti-inflammatory drug',
  'ACE':  'angiotensin-converting enzyme',
  'ARB':  'angiotensin receptor blocker',
  'PPI':  'proton pump inhibitor',
  'HbA1c': 'glycated hemoglobin',
  'LDL':  'low-density lipoprotein',
  'HDL':  'high-density lipoprotein',
  'TG':   'triglyceride',
};

const UPPER_ABBR_PATTERN = /\b[A-Z][A-Za-z0-9]{1,6}\b/g;

/** Title-case words (e.g. "Lethal") are not clinical abbreviations; skip slow UMLS hit. */
function shouldSkipUmlsLookup(token) {
  return /^[A-Z][a-z]{2,}$/.test(token);
}

async function lookupUmls(token) {
  const cacheKey = `${CACHE_PREFIX}:${token.toLowerCase()}`;
  const hit = cacheGet(cacheKey);
  if (hit !== undefined) return hit === '__miss__' ? null : hit;

  try {
    const row = await vectorStore.lookupUmlsByStr(token);
    if (row) {
      const preferred = row.metadata?.str || null;
      cacheSet(cacheKey, preferred || '__miss__');
      return preferred;
    }
  } catch (err) {
    logger.warn('normalizer.umls_lookup.skip', { token, message: err.message });
    return null;
  }

  cacheSet(cacheKey, '__miss__');
  return null;
}

/**
 * Normalize medical abbreviations in a question string.
 * Returns { normalized, expansions } where expansions is a map of what was expanded.
 */
async function normalizeQuestion(question) {
  const expansions = {};
  const tokens = question.match(UPPER_ABBR_PATTERN) || [];
  const unique = [...new Set(tokens)];

  let result = question;

  for (const token of unique) {
    const upper = token.toUpperCase();

    if (STATIC_ABBREVIATIONS[token] || STATIC_ABBREVIATIONS[upper]) {
      const expansion = STATIC_ABBREVIATIONS[token] || STATIC_ABBREVIATIONS[upper];
      expansions[token] = expansion;
      result = result.replace(new RegExp(`\\b${token}\\b`, 'g'), `${token} (${expansion})`);
      continue;
    }

    if (shouldSkipUmlsLookup(token)) continue;

    const umlsTerm = await lookupUmls(token);
    if (umlsTerm && umlsTerm.toLowerCase() !== token.toLowerCase()) {
      expansions[token] = umlsTerm;
      result = result.replace(new RegExp(`\\b${token}\\b`, 'g'), `${token} (${umlsTerm})`);
    }
  }

  return { normalized: result, expansions };
}

module.exports = { normalizeQuestion, STATIC_ABBREVIATIONS };
