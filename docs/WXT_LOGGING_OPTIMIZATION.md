# WXT Logging Optimization

## Tree-Shaking Verification

WXT uses Vite which automatically tree-shakes code based on `import.meta.env.DEV`. Our logger utility is optimized for zero production overhead.

## How It Works

```typescript
// src/lib/utils/logger.ts
const IS_DEV = import.meta.env.DEV;
const IS_DEBUG = import.meta.env.VITE_DEBUG === 'true';

export const logger = {
  debug(component: string, message: string, data?: any) {
    if (!IS_DEBUG && !IS_DEV) return;  // Dead code elimination
    console.debug(`[${component}]`, message, data);
  },

  info(component: string, message: string, data?: any) {
    if (!IS_DEV) return;  // Dead code elimination
    console.log(`[${component}]`, message, data);
  }
};
```

Vite's production build recognizes that `import.meta.env.DEV` is `false` in production, making the entire function body unreachable. The bundler eliminates this dead code.

## Verification Steps

### 1. Build for production

```bash
pnpm build
```

### 2. Check bundle size

```bash
ls -lh .output/chrome-mv3/chunks/*.js | grep -i logger
```

### 3. Verify dead code elimination

```bash
# Search for debug strings in production bundle
grep -r "debug(" .output/chrome-mv3/ || echo "Debug logs stripped"
```

## Expected Results

| Build Mode | log.debug() | log.info() | log.warn() | log.error() |
|------------|-------------|------------|------------|-------------|
| Development | Logged | Logged | Logged | Logged |
| Production | Stripped | Stripped | Logged | Logged |

## Memory Impact

- **Development:** ~2KB (unminified)
- **Production:** ~500 bytes (minified, debug/info stripped)

## WXT-Specific Features

WXT provides additional optimizations via Vite:

### Conditional Imports (Future Enhancement)

```typescript
// Complete elimination of logger module in production
const logger = import.meta.env.DEV
  ? await import('~/lib/utils/logger')
  : { debug: () => {}, info: () => {}, warn: console.warn, error: console.error };
```

This approach completely eliminates the logger module from production builds.

### Environment-Based Configuration

WXT automatically sets `import.meta.env.DEV`:

| Command | `import.meta.env.DEV` | `import.meta.env.MODE` |
|---------|----------------------|------------------------|
| `pnpm dev` | `true` | `development` |
| `pnpm build` | `false` | `production` |

## Testing Optimization

### Development Mode

```bash
VITE_DEBUG=true pnpm dev
```

All log levels visible in console.

### Production Simulation

```bash
pnpm build
# Load extension from .output/chrome-mv3/
# Only warn/error should appear in console
```

### Bundle Analysis

```bash
# Check if debug strings exist in production bundle
grep -r "\\[.*\\] debug" .output/chrome-mv3/ && echo "WARNING: Debug logs in bundle" || echo "Clean!"
```

## Integration with Sentry (Future)

The logger is designed for future Sentry integration:

```typescript
// src/lib/utils/logger.ts
error(component: string, message: string, error?: Error) {
  console.error(`[${component}]`, message, error);

  if (!IS_DEV && error instanceof Error) {
    // TODO: Sentry integration
    // Sentry.captureException(error, { tags: { component } });
  }
}
```

## Best Practices

1. **Use structured data:** Pass objects, not interpolated strings
   ```typescript
   // Good
   log.info('Case created', { caseId, title });

   // Bad
   log.info(`Case ${caseId} created with title ${title}`);
   ```

2. **Keep messages short:** Let the data speak
   ```typescript
   // Good
   log.debug('API response', { status, count: items.length });

   // Bad
   log.debug('Received API response with status code and item count', { status, items });
   ```

3. **Use appropriate levels:** Debug for verbose, info for lifecycle, warn for issues, error for failures
