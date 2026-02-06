import { useState, useEffect, useMemo } from 'react';
import playhtml from '../playhtml-singleton';
import type { PlayHTMLComponents } from 'playhtml';

export interface PermissionState {
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canModerate: boolean;
  canAdmin: boolean;
  [action: string]: boolean;
}

/**
 * Hook to check user permissions for a specific element.
 *
 * NOTE: Permissions are client-side advisory only. See auth.ts in the core package.
 *
 * @param elementId - The ID of the element to check permissions for
 * @param customActions - Additional custom actions to check beyond the defaults
 * @returns Object with permission states for different actions
 */
export function usePlayHTMLPermissions(
  elementId: string,
  customActions: string[] = []
): PermissionState {
  const defaultActions = ['read', 'write', 'delete', 'moderate', 'admin'];
  // Memoize so the dependency array is stable across renders
  const allActions = useMemo(
    () => [...defaultActions, ...customActions],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customActions.join(',')]
  );

  // Default to deny until permissions are resolved
  const [permissions, setPermissions] = useState<PermissionState>(() => {
    const initial: PermissionState = {
      canRead: false,
      canWrite: false,
      canDelete: false,
      canModerate: false,
      canAdmin: false,
    };

    // Add custom actions to initial state
    customActions.forEach(action => {
      initial[`can${action.charAt(0).toUpperCase() + action.slice(1)}`] = false;
    });

    return initial;
  });

  useEffect(() => {
    const updatePermissions = async () => {
      const auth = (playhtml as PlayHTMLComponents).auth;
      if (!auth?.getCurrentIdentity || !auth?.checkPermission) {
        console.warn('[usePlayHTMLPermissions] PlayHTML auth not available');
        return;
      }

      const identity = auth.getCurrentIdentity();

      const newPermissions: PermissionState = {
        canRead: false,
        canWrite: false,
        canDelete: false,
        canModerate: false,
        canAdmin: false,
      };

      try {
        for (const action of allActions) {
          const hasPermission = await auth.checkPermission(elementId, action, identity);
          const camelCaseAction = `can${action.charAt(0).toUpperCase() + action.slice(1)}`;
          newPermissions[camelCaseAction] = hasPermission;
        }
      } catch (error) {
        console.error('[usePlayHTMLPermissions] Error checking permissions:', error);
      }

      setPermissions(newPermissions);
    };

    updatePermissions();

    // Listen for auth changes
    const handleAuthReady = () => updatePermissions();
    window.addEventListener('playhtmlAuthReady', handleAuthReady);

    return () => {
      window.removeEventListener('playhtmlAuthReady', handleAuthReady);
    };
  }, [elementId, allActions]);

  return permissions;
}
