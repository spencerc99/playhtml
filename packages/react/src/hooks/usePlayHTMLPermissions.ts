import { useState, useEffect } from 'react';
import playhtml from '../playhtml-singleton';

export interface PermissionState {
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canModerate: boolean;
  canAdmin: boolean;
  [action: string]: boolean;
}

/**
 * Hook to check user permissions for a specific element
 * @param elementId - The ID of the element to check permissions for
 * @param customActions - Additional custom actions to check beyond the defaults
 * @returns Object with permission states for different actions
 */
export function usePlayHTMLPermissions(
  elementId: string,
  customActions: string[] = []
): PermissionState {
  const defaultActions = ['read', 'write', 'delete', 'moderate', 'admin'];
  const allActions = [...defaultActions, ...customActions];
  
  const [permissions, setPermissions] = useState<PermissionState>(() => {
    const initial: PermissionState = {
      canRead: true,
      canWrite: true,
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
      // @ts-ignore - auth may not be typed in the React package yet
      if (!playhtml.auth?.getCurrentIdentity || !playhtml.auth?.checkPermission) {
        console.warn('[usePlayHTMLPermissions] PlayHTML auth not available');
        return;
      }
      
      // @ts-ignore - auth may not be typed in the React package yet
      const identity = playhtml.auth.getCurrentIdentity();
      
      const newPermissions: PermissionState = {
        canRead: true,
        canWrite: true,
        canDelete: false,
        canModerate: false,
        canAdmin: false,
      };

      try {
        for (const action of allActions) {
          // @ts-ignore - auth may not be typed in the React package yet
          const hasPermission = await playhtml.auth.checkPermission(elementId, action, identity);
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
  }, [elementId, allActions.join(',')]);

  return permissions;
}