// ABOUTME: Renders a feature demo for role-based capability permissions.
// ABOUTME: Cycles sample users through locked and unlocked permission states.
import { useEffect, useState } from "react";
import "./Permissions.scss";

type PermissionKey = "silver" | "gold";

interface Permission {
  id: string;
  name: string;
  isLocked: boolean;
  hasKey: boolean;
  keyType?: PermissionKey;
  action: string;
}

interface User {
  id: string;
  name: string;
  keys: PermissionKey[];
  color: string;
}

const permissions: Permission[] = [
  {
    id: "move",
    name: "Move Elements",
    isLocked: false,
    hasKey: true,
    action: "can-move",
  },
  {
    id: "edit",
    name: "Edit Content",
    isLocked: true,
    hasKey: true,
    keyType: "silver",
    action: "can-edit",
  },
  {
    id: "delete",
    name: "Admin",
    isLocked: true,
    hasKey: false,
    keyType: "gold",
    action: "can-delete",
  },
];

const users: User[] = [
  { id: "0", name: "Visitor", keys: [], color: "#888" },
  { id: "1", name: "Editor", keys: ["silver"], color: "#888" },
  {
    id: "2",
    name: "Admin",
    keys: ["silver", "gold"],
    color: "#4CAF50",
  },
];

export function Permissions() {
  const [currentUser, setCurrentUser] = useState(0);
  const [permissionStates, setPermissionStates] = useState(permissions);
  const [attemptingUnlock, setAttemptingUnlock] = useState<string | null>(null);
  const userHasPermissionKey = (keyType?: PermissionKey) =>
    !keyType || users[currentUser].keys.includes(keyType);

  // Rotate through users
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentUser((prev) => (prev + 1) % users.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Update permission states based on current user
  useEffect(() => {
    const user = users[currentUser];
    setPermissionStates((prev) =>
      prev.map((perm) => {
        const hasKey = !perm.keyType || user.keys.includes(perm.keyType);
        return {
          ...perm,
          hasKey,
          isLocked: Boolean(perm.keyType && !hasKey),
        };
      })
    );
  }, [currentUser]);

  const handlePermissionClick = (permId: string) => {
    const perm = permissionStates.find((p) => p.id === permId);
    const user = users[currentUser];

    if (perm && perm.isLocked && !userHasPermissionKey(perm.keyType)) {
      setAttemptingUnlock(permId);
      setTimeout(() => setAttemptingUnlock(null), 1000);
    } else if (perm && !perm.isLocked) {
      // Toggle the permission action (simulate usage)
      setPermissionStates((prev) =>
        prev.map((p) => (p.id === permId ? { ...p, isLocked: false } : p))
      );
    }
  };

  const getKeyIcon = (keyType?: PermissionKey) => {
    switch (keyType) {
      case "silver":
        return "🔵";
      case "gold":
        return "🟡";
      default:
        return "";
    }
  };

  const getLockIcon = (isLocked: boolean, hasKey: boolean) => {
    if (!isLocked) return "🔓";
    return hasKey ? "🔐" : "🔒";
  };

  return (
    <div className="permissions">
      <div className="user-section">
        <div className="user-switcher">
          <div
            className="current-user"
            style={{ borderColor: users[currentUser].color }}
          >
            <div
              className="user-name"
              style={{ color: users[currentUser].color }}
            >
              {users[currentUser].name}
            </div>
            <div className="user-keys">
              {users[currentUser].keys.map((key) => (
                <span key={key} className="key-icon">
                  {getKeyIcon(key)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="permissions-grid">
        {permissionStates.map((perm) => {
          const isAttempting = attemptingUnlock === perm.id;

          return (
            <div
              key={perm.id}
              className={`permission-item ${
                perm.isLocked ? "locked" : "unlocked"
              } ${isAttempting ? "attempting" : ""}`}
              onClick={() => handlePermissionClick(perm.id)}
            >
              <div className="permission-header">
                <div className="lock-status">
                  {getLockIcon(perm.isLocked, perm.hasKey)}
                </div>
                <div className="required-key">{getKeyIcon(perm.keyType)}</div>
              </div>

              <div className="permission-info">
                <div className="permission-name">{perm.name}</div>
                <div className="permission-action">{perm.action}</div>
              </div>

              {isAttempting && (
                <div className="access-attempt">
                  <div className="shake-animation">🚫</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
