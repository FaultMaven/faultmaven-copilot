/**
 * Role-Based Access Control Utilities
 *
 * Provides helper functions for checking user roles and permissions.
 * Used to implement role-based UI visibility and access control.
 */

import { User } from '../api';

/**
 * Role constants
 */
export const ROLES = {
  ADMIN: 'admin',
  USER: 'user',
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];

/**
 * Check if a user has a specific role
 *
 * @param user - User object (can be null for unauthenticated users)
 * @param role - Role to check for
 * @returns true if user has the role, false otherwise
 *
 * @example
 * ```typescript
 * if (hasRole(currentUser, ROLES.ADMIN)) {
 *   // Show admin features
 * }
 * ```
 */
export function hasRole(user: User | null | undefined, role: string): boolean {
  if (!user || !user.roles) {
    return false;
  }
  return user.roles.includes(role);
}

/**
 * Check if a user is an admin
 *
 * @param user - User object (can be null for unauthenticated users)
 * @returns true if user has admin role, false otherwise
 *
 * @example
 * ```typescript
 * if (isAdmin(currentUser)) {
 *   // Show admin panel
 * }
 * ```
 */
export function isAdmin(user: User | null | undefined): boolean {
  return hasRole(user, ROLES.ADMIN);
}

/**
 * Check if a user has any of the specified roles
 *
 * @param user - User object
 * @param roles - Array of roles to check
 * @returns true if user has at least one of the roles
 *
 * @example
 * ```typescript
 * if (hasAnyRole(currentUser, [ROLES.ADMIN, ROLES.MODERATOR])) {
 *   // Show moderation features
 * }
 * ```
 */
export function hasAnyRole(user: User | null | undefined, roles: string[]): boolean {
  if (!user || !user.roles) {
    return false;
  }
  return roles.some(role => user.roles!.includes(role));
}

/**
 * Check if a user has all of the specified roles
 *
 * @param user - User object
 * @param roles - Array of roles to check
 * @returns true if user has all the roles
 *
 * @example
 * ```typescript
 * if (hasAllRoles(currentUser, [ROLES.ADMIN, ROLES.DEVELOPER])) {
 *   // Show dev tools
 * }
 * ```
 */
export function hasAllRoles(user: User | null | undefined, roles: string[]): boolean {
  if (!user || !user.roles) {
    return false;
  }
  return roles.every(role => user.roles!.includes(role));
}

/**
 * Get user's roles as a formatted string
 *
 * @param user - User object
 * @returns Comma-separated list of roles or 'No roles'
 */
export function getRolesDisplay(user: User | null | undefined): string {
  if (!user || !user.roles || user.roles.length === 0) {
    return 'No roles';
  }
  return user.roles.join(', ');
}
