/**
 * Utility to safely handle tags field from backend API
 * Provides defensive handling for API contract compliance
 */

let hasLoggedWarning = false;

export function normalizeTags(tags: unknown): string[] {
  // Fast path: backend returns correct array format
  if (Array.isArray(tags)) {
    return tags.filter(tag => typeof tag === 'string' && tag.trim());
  }
  
  // Defensive path: handle string format (should not happen with fixed backend)
  if (typeof tags === 'string' && tags.trim()) {
    // Log API inconsistency for debugging (only once per session)
    if (!hasLoggedWarning) {
      console.warn('[API] Backend returned tags as string instead of array:', tags);
      console.warn('[API] This indicates a backend regression - tags should always be string[]');
      hasLoggedWarning = true;
    }
    return tags.split(',').map(tag => tag.trim()).filter(tag => tag);
  }
  
  // Fallback: return empty array for null/undefined/invalid types
  return [];
}
