import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ApiError, http, UNAUTHORIZED_EVENT } from '../services/http';
import type { UserRole } from '../types';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  departmentCode: string | null;
  phone: string | null;
  designation: string | null;
  employeeId: string | null;
  office: string | null;
  mustChangePassword: boolean;
  isDemo: boolean;
  studentId: string | null;
  portal: string | null;
  demoData: boolean;
}

interface AuthState {
  user: SessionUser | null;
  checking: boolean;
  expiredMessage: string | null;
  login: (email: string, password: string, role: UserRole | undefined, remember: boolean) => Promise<SessionUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [expiredMessage, setExpiredMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setUser(await http.get<SessionUser>('/auth/me'));
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401) throw err;
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refresh()
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, [refresh]);

  // Any 401 from the API (expired/revoked session) returns the user to the login screen.
  useEffect(() => {
    const onUnauthorized = (e: Event) => {
      setUser((prev) => {
        if (prev) setExpiredMessage((e as CustomEvent).detail || 'Your session has ended. Please sign in again.');
        return null;
      });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async (email: string, password: string, role: UserRole | undefined, remember: boolean) => {
    const res = await http.post<SessionUser>('/auth/login', { email, password, role, remember });
    setExpiredMessage(null);
    setUser(res.data);
    return res.data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await http.post('/auth/logout');
    } finally {
      setUser(null);
    }
  }, []);

  return <AuthContext.Provider value={{ user, checking, expiredMessage, login, logout, refresh }}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
