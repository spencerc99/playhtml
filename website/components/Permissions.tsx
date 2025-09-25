import React, { useEffect, useState } from "react";
import "./Permissions.scss";

interface Permission {
  id: string;
  name: string;
  isLocked: boolean;
  hasKey: boolean;
  keyType?: "silver" | "gold";
  action: string;
}

interface User {
  id: string;
  name: string;
  keys: string[];
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
      prev.map((perm) => ({
        ...perm,
        hasKey: user.keys.includes(perm.keyType),
        isLocked: !user.keys.includes(perm.keyType),
      }))
    );
  }, [currentUser]);

  const handlePermissionClick = (permId: string) => {
    const perm = permissionStates.find((p) => p.id === permId);
    const user = users[currentUser];

    if (perm && perm.isLocked && !user.keys.includes(perm.keyType)) {
      setAttemptingUnlock(permId);
      setTimeout(() => setAttemptingUnlock(null), 1000);
    } else if (perm && !perm.isLocked) {
      // Toggle the permission action (simulate usage)
      setPermissionStates((prev) =>
        prev.map((p) => (p.id === permId ? { ...p, isLocked: false } : p))
      );
    }
  };

  const getKeyIcon = (keyType: string) => {
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
