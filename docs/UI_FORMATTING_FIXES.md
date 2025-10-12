# UI Formatting Fixes for FaultMaven Copilot

## Overview
This document describes the formatting improvements made to the FaultMaven Copilot browser extension to enhance the display of backend responses.

## Issues Fixed

### 1. PII Redaction Token Display
**Before:** Raw tokens appearing in text
```
The user with driver license <US_DRIVER_LICENSE> called from <PHONE_NUMBER>.
Contact person <NRP> at <EMAIL_ADDRESS>.
```

**After:** Styled badge components with user-friendly labels
```
The user with driver license [🔒 REDACTED: Driver License] called from [🔒 REDACTED: Phone Number].
Contact person [🔒 REDACTED: ID Number] at [🔒 REDACTED: Email].
```

The PII badges are now:
- Visually distinct with yellow background (bg-yellow-100)
- Include a lock icon for visual indication
- Show human-readable labels instead of technical tokens
- Have tooltips explaining the redaction
- Inline with proper spacing

### 2. Footnote Reference Markers
**Before:** Duplicate or incorrectly placed [1], [2], [3] markers
```
The database connection failed [1]. Check the logs [2] for details [3].
```

**After:** Clean text with intelligent source citations
```
The database connection failed. Check the logs for details. [1]
```

Source citations are now:
- Intelligently placed at the end of relevant paragraphs
- Only shown when sources are actually available
- Styled as hoverable badges with preview tooltips
- Not duplicated from backend formatting

### 3. Markdown Rendering
**Before:** Inconsistent markdown rendering with formatting issues

**After:** Proper ReactMarkdown rendering with:
- Clean code blocks with syntax highlighting
- Proper heading hierarchy (h1, h2, h3)
- Styled lists (ul, ol) with proper spacing
- Tables with borders and proper formatting
- Blockquotes with visual distinction
- Inline code highlighting

## Technical Implementation

### New Files Created

#### 1. `src/lib/utils/text-processor.ts`
Core text processing utility with:
- `cleanResponseText()` - Main cleaning function
- `formatPIITokens()` - Converts PII tokens to UI markers
- `removeStandaloneFootnotes()` - Strips backend footnote markers
- `normalizeWhitespace()` - Cleans up excessive whitespace
- `extractPIITokens()` - Debugging utility for token extraction
- `registerPIIToken()` - Extensible token registry

Supported PII token types:
- US_DRIVER_LICENSE → Driver License
- PHONE_NUMBER → Phone Number
- EMAIL_ADDRESS → Email
- CREDIT_CARD → Credit Card
- US_SSN → SSN
- US_PASSPORT → Passport
- IP_ADDRESS → IP Address
- PERSON → Name
- NRP → ID Number
- LOCATION → Location
- DATE_TIME → Date/Time
- URL → URL
- IBAN_CODE → IBAN
- US_BANK_NUMBER → Bank Account
- CRYPTO → Crypto Wallet
- MEDICAL_LICENSE → Medical License
- US_ITIN → ITIN

### Modified Files

#### 1. `src/shared/ui/components/InlineSourcesRenderer.tsx`
Enhanced component with:

**New Components:**
- `PIIBadge` - Styled badge component for redacted content
- `processPIITokens()` - Converts text to React nodes with badges

**Enhanced Functions:**
- `createMarkdownComponents()` - Factory for markdown components with PII handling
- Text node processor for PII tokens in any markdown element
- Paragraph processor that handles both PII and source citations

**Rendering Flow:**
```
Backend Response
    ↓
cleanResponseText() - Remove footnotes, format PII tokens
    ↓
ReactMarkdown with enhanced components
    ↓
processPIITokens() - Convert markers to PIIBadge components
    ↓
injectSourceCitations() - Add source citations where relevant
    ↓
Final rendered UI
```

## Component Styling

### PII Badge Component
```tsx
<span className="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 text-xs font-medium bg-yellow-100 text-yellow-800 border border-yellow-300 rounded-md">
  <LockIcon />
  REDACTED: {label}
</span>
```

### Source Citation Badge
```tsx
<sup className="text-xs text-blue-600 cursor-help hover:text-blue-800 font-medium bg-blue-50 px-1 rounded">
  [{index}]
</sup>
```
- Appears on hover to show source preview
- Links to full document when available
- Shows source type (knowledge base, log analysis, etc.)

## Testing

### Unit Tests
Created comprehensive test suite in `src/test/utils/text-processor.test.ts`:
- 15 test cases covering all text processing scenarios
- All tests passing ✓
- Edge cases handled (empty input, unknown tokens, mixed formatting)

### Test Coverage
- PII token formatting (multiple types)
- Footnote removal
- Whitespace normalization
- Mixed formatting scenarios
- Unknown token handling
- Token registration
- Token extraction

## Usage Examples

### Example 1: Database Error with PII
**Input:**
```
Database connection error at <IP_ADDRESS> [1].
User <PERSON> with SSN <US_SSN> was affected [2].
Check logs at <URL> for details [3].
```

**Rendered Output:**
```
Database connection error at [🔒 REDACTED: IP Address].
User [🔒 REDACTED: Name] with SSN [🔒 REDACTED: SSN] was affected.
Check logs at [🔒 REDACTED: URL] for details. [1]
```

### Example 2: Markdown with Code
**Input:**
```
**Solution:** Run the command `kubectl get pods` to check status.

```bash
kubectl logs pod-name
```

Contact support at <EMAIL_ADDRESS> if issues persist [1].
```

**Rendered Output:**
- Bold "Solution:" label
- Inline code `kubectl get pods` with gray background
- Code block with syntax highlighting
- Email shown as [🔒 REDACTED: Email] badge
- Source citation [1] at paragraph end

## Benefits

1. **Privacy Protection** - PII tokens are clearly marked and visually distinct
2. **Improved Readability** - Clean text without distracting markers
3. **Better UX** - Consistent markdown rendering with proper styling
4. **Accessibility** - Lock icons and tooltips help all users understand redactions
5. **Maintainability** - Centralized text processing with extensible token registry
6. **Performance** - Memoized components prevent unnecessary re-renders

## Browser Compatibility

All features work in:
- Chrome 88+ (extension target)
- Firefox 91+ (extension target)
- Uses standard CSS and React patterns
- No browser-specific dependencies

## Future Enhancements

Potential improvements:
1. User preference for showing/hiding redacted content
2. Different badge styles for different PII sensitivity levels
3. Analytics on redaction frequency for privacy audits
4. Option to export sanitized conversation history
5. Custom PII token patterns per organization
