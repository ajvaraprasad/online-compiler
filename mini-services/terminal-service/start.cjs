// CJS wrapper to load the TypeScript entry point via tsx/register
// This avoids the stability issues with npx tsx running directly
require('tsx/cjs');
require('./index.ts');
