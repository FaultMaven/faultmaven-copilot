# Changelog: User-Scoped Knowledge Base & Role-Based Access Control

**Date**: 2025-10-23
**Version**: 0.4.0
**Type**: Feature Enhancement

## Summary

Implemented two major features to enhance security and user experience:
1. **User-Scoped Knowledge Base** - Migrated from global KB to per-user personal knowledge bases
2. **Role-Based Access Control (RBAC)** - Added admin/user role distinction with UI visibility controls

## Motivation

### Problems Solved

**Before**:
- All users shared a single global knowledge base (no privacy/isolation)
- No way to distinguish personal runbooks from system-wide documentation
- Admin features visible to all users, causing confusion and 403 errors
- No role-based UI hiding or route protection

**After**:
- Each user has a private, isolated knowledge base
- Clear separation between personal KB and system KB
- Admin features hidden from regular users
- Graceful error handling for permission issues

## Changes by Category

### 1. Type System Enhancements

**Files Modified**:
- `src/lib/api.ts`
- `src/shared/ui/hooks/useAuth.ts`

**Changes**:
- Added `roles?: string[]` field to `User`, `AuthState`, and `UserProfile` interfaces
- Enhanced type safety for role-based logic
- All role checks are now type-safe

### 2. Role Utilities

**New File**: `src/lib/utils/roles.ts`

**Exports**:
```typescript
export const ROLES = { ADMIN: 'admin', USER: 'user' };
export type Role = typeof ROLES[keyof typeof ROLES];

export function hasRole(user: User | null, role: string): boolean;
export function isAdmin(user: User | null): boolean;
export function hasAnyRole(user: User, roles: string[]): boolean;
export function hasAllRoles(user: User, roles: string[]): boolean;
export function getRolesDisplay(user: User): string;
```

### 3. User-Scoped KB API Functions

**File Modified**: `src/lib/api.ts`

**New Functions**:
```typescript
// User-scoped KB operations
export async function uploadUserKBDocument(userId: string, ...): Promise<KnowledgeDocument>
export async function getUserKBDocuments(userId: string, ...): Promise<DocumentListResponse>
export async function deleteUserKBDocument(userId: string, docId: string): Promise<void>
export async function getUserKBStats(userId: string): Promise<any>
```

**Endpoints Used**:
- `POST /api/v1/users/{user_id}/kb/documents`
- `GET /api/v1/users/{user_id}/kb/documents`
- `DELETE /api/v1/users/{user_id}/kb/documents/{doc_id}`
- `GET /api/v1/users/{user_id}/kb/stats`

### 4. Authentication Enhancements

**File Modified**: `src/lib/api.ts`

**Changes**:
- Added `getCurrentUser()` method to `AuthManager` class
- Returns full user object with roles from auth state
- Enables role-based logic throughout the application

**File Modified**: `src/shared/ui/hooks/useAuth.ts`

**New Exports**:
```typescript
{
  currentUser: User | null,      // Full user object with roles
  hasRole: (role: string) => boolean,
  isAdmin: () => boolean,
  ROLES,                         // Role constants
  // ... existing auth exports
}
```

### 5. Component Updates

#### KnowledgeBaseView (User KB)

**File Modified**: `src/shared/ui/KnowledgeBaseView.tsx`

**Changes**:
- Migrated all API calls to user-scoped endpoints
- Added `useAuth()` hook to get current user
- Updated: `uploadDocument` → `uploadUserKBDocument`
- Updated: `getDocuments` → `getUserKBDocuments`
- Updated: `deleteDocument` → `deleteUserKBDocument`
- Added user context validation with helpful error messages
- Updated duplicate detection to use user-scoped queries

#### GlobalKBView (Admin KB)

**New File**: `src/shared/ui/GlobalKBView.tsx`

**Features**:
- Admin-only component for system-wide KB management
- Purple-themed UI with "Admin Only" badge
- Uses global `/api/v1/knowledge/*` endpoints
- Built-in access control (shows error if not admin)
- Same three-tab interface as KnowledgeBaseView
- Full CRUD operations for global documents

#### SidePanelApp (Navigation)

**File Modified**: `src/shared/ui/SidePanelApp.tsx`

**Changes**:
- Added third tab state: `'copilot' | 'kb' | 'admin-kb'`
- Renamed "Knowledge Base" → "My Knowledge Base"
- Added "Global KB (Admin)" button (visible only to admins)
- Implemented route protection with redirect
- Added `useAuth()` hook for role checks
- Conditional rendering of GlobalKBView component

### 6. Error Handling

**File Modified**: `src/lib/utils/api-error-handler.ts`

**Changes**:
- Added new `ErrorType.PERMISSION` for 403 Forbidden errors
- Detects permission-related errors (403, 'forbidden', 'admin access required')
- User-friendly message: "🔐 This feature requires admin access..."
- Distinguishes between 401 (not logged in) and 403 (insufficient permissions)
- Updated `formatErrorForChat()` to handle permission errors

### 7. Backend Changes

**File Modified**: `FaultMaven/faultmaven/models/auth.py`

**Changes**:
- Added `roles: list[str]` field to `DevUser` dataclass
- Default roles: `['admin']` for development users
- Updated `to_dict()` method to include roles
- Updated `from_dict()` method to parse roles
- Added `__post_init__` to set default roles if not provided

## API Changes

### New Endpoints (Already Implemented in Backend)

The following endpoints were already implemented in the backend but not used by the frontend:

```
POST   /api/v1/users/{user_id}/kb/documents       - Upload to user KB
GET    /api/v1/users/{user_id}/kb/documents       - List user's documents
DELETE /api/v1/users/{user_id}/kb/documents/{id}  - Delete from user KB
GET    /api/v1/users/{user_id}/kb/stats           - Get user KB stats
```

### Existing Endpoints (Now Admin-Only)

These endpoints now require admin role:

```
POST   /api/v1/knowledge/documents       - Upload to global KB (admin)
GET    /api/v1/knowledge/documents       - List global documents (admin)
DELETE /api/v1/knowledge/documents/{id}  - Delete from global KB (admin)
```

## Migration Notes

### Breaking Changes

**None for Regular Users**:
- Regular users will automatically use their personal KB
- No action required from users

**For Admins**:
- "Knowledge Base" tab renamed to "My Knowledge Base"
- New "Global KB (Admin)" tab for system-wide management
- No data migration needed (backend handles scoping)

### Data Isolation

- User KB documents stored in separate ChromaDB collections: `user_kb_{user_id}`
- Global KB documents stored in default collection
- No cross-contamination between user and global KBs

## Testing

### Compilation

✅ TypeScript compilation passes with zero errors
```bash
pnpm compile
# Success: No errors
```

### Type Safety

✅ All role checks are type-safe
✅ User KB functions require user_id parameter
✅ Error handling properly typed

### Manual Testing Checklist

- [ ] Regular user logs in → sees "My Knowledge Base" only
- [ ] Admin user logs in → sees both "My Knowledge Base" and "Global KB (Admin)"
- [ ] Regular user attempts to access /admin-kb → redirected to copilot
- [ ] Upload to user KB → document scoped to user
- [ ] Upload to global KB (admin) → document available system-wide
- [ ] 403 error shows friendly message
- [ ] Roles persist across page refresh
- [ ] Duplicate detection works in user KB

## Documentation Updates

**File Modified**: `ARCHITECTURE.md`

**Sections Updated**:
1. Authentication & Authorization
   - Added RBAC explanation
   - Updated AuthState structure with roles
   - Documented role utilities

2. Knowledge Base API
   - Split into "User Knowledge Base" and "Global Knowledge Base"
   - Documented all user KB endpoints
   - Added note about admin-only access

3. UI Components
   - Added KnowledgeBaseView documentation
   - Added GlobalKBView documentation
   - Added role-based navigation explanation

4. Error Handling
   - Added 403 Permission error to error type mapping
   - Documented friendly error messages

## Security Considerations

### Defense in Depth

1. **Backend Enforcement**: APIs enforce role-based access control
2. **Frontend Protection**: UI hides admin features from regular users
3. **Route Guards**: Non-admins redirected from admin pages
4. **Error Handling**: 403 errors handled gracefully

### No Security Bypasses

- Regular users cannot access admin APIs (backend validates)
- UI hiding is for UX only, not security (security is backend-enforced)
- All admin operations require valid admin role in JWT token

## Performance Impact

**Minimal**:
- No significant performance changes
- User KB queries slightly faster (smaller collection size)
- Same ChromaDB infrastructure used

## Future Enhancements

Potential improvements for future versions:

1. **User KB Sharing**: Allow users to share specific documents with teams
2. **KB Templates**: System templates that users can copy to their KB
3. **Advanced RBAC**: More granular roles (moderator, analyst, etc.)
4. **KB Analytics**: Track document usage and search patterns
5. **Bulk Operations**: Import/export for user KB migration
6. **Version Control**: Track changes to KB documents over time

## Rollback Plan

If issues arise:

1. **Frontend Only**: Revert frontend to use global KB endpoints
2. **Keep Backend**: Backend user KB endpoints remain available
3. **No Data Loss**: Both global and user KB data preserved

## Contributors

- Implementation: Claude (AI Assistant)
- Review: Pending
- Testing: Pending

## References

- Backend API Spec: `FaultMaven/docs/api/openapi.locked.yaml`
- Security Issue: `FaultMaven/docs/security/KNOWLEDGE_BASE_USER_SCOPING_ISSUE.md`
- Architecture: `faultmaven-copilot/ARCHITECTURE.md`
