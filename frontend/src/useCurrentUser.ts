import { useSyncExternalStore } from "react";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

const AUTH_CHANGE = "auth-change";

let cachedRaw: string | null = null;
let cachedUser: CurrentUser | null = null;

function getSnapshot(): CurrentUser | null {
  const raw = localStorage.getItem("user");
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedUser = raw ? (JSON.parse(raw) as CurrentUser) : null;
    } catch {
      cachedUser = null;
    }
  }
  return cachedUser;
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(AUTH_CHANGE, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(AUTH_CHANGE, callback);
  };
}

export function useCurrentUser(): CurrentUser | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

export function isAdmin(user: CurrentUser | null): boolean {
  return user?.role === "admin";
}

export function setCurrentUser(user: CurrentUser): void {
  localStorage.setItem("user", JSON.stringify(user));
  window.dispatchEvent(new Event(AUTH_CHANGE));
}

export function clearCurrentUser(): void {
  localStorage.removeItem("user");
  window.dispatchEvent(new Event(AUTH_CHANGE));
}
