const fs = require('fs');
const path = require('path');

// Patterns to forbid
const FORBIDDEN_PATTERNS = [
  { regex: /console\.log\s*\(/g, message: 'Found console.log()' },
  { regex: /console\.debug\s*\(/g, message: 'Found console.debug()' },
  { regex: /\bdebugger\b/g, message: 'Found debugger statement' }
];

// Files passed by lint-staged are in process.argv
const files = process.argv.slice(2);
let hasError = false;

for (const file of files) {
  // Only check .js, .jsx, .ts, .tsx files
  if (!/\.(js|jsx|ts|tsx)$/.test(file)) continue;
  const normalized = file.replace(/\\/g, '/');
  if (normalized.endsWith('scripts/check-console-logs.js')) continue;
  // Ignore all scripts (ops/ingest/migrations helpers, etc.)
  if (normalized.includes('/scripts/')) continue;
  if (normalized.includes('/apps/web/lib/logger.ts')) continue;
  if (normalized.includes('/apps/web/middleware.ts')) continue;
  
  try {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Basic inline comment ignore (doesn't handle block comments perfectly but good enough for pre-commit)
      if (line.trim().startsWith('//')) continue;
      
      for (const pattern of FORBIDDEN_PATTERNS) {
        pattern.regex.lastIndex = 0;
        if (pattern.regex.test(line)) {
          console.error(`\x1b[31mError:\x1b[0m ${pattern.message} in \x1b[36m${file}\x1b[0m at line ${i + 1}`);
          console.error(`  > ${line.trim()}`);
          hasError = true;
        }
      }
    }
  } catch (err) {
    console.error(`Failed to read file ${file}:`, err);
  }
}

if (hasError) {
  console.error('\n\x1b[31m[!] Commit blocked.\x1b[0m Please remove the forbidden statements above.');
  console.error('If you need to log something intentionally on the backend, use the Winston logger (logger.info, logger.debug).\n');
  process.exit(1);
}

process.exit(0);
