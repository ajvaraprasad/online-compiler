'use client';

import { useEffect, useCallback } from 'react';
import { useIDEStore } from '@/store/useIDEStore';
import { authAPI, setToken, getToken } from '@/lib/api';

export function useAuth() {
  const { user, isAuthenticated, isAuthModalOpen, authModalTab, setUser, openAuthModal, closeAuthModal, logout: storeLogout } = useIDEStore();

  // Check for existing session on mount
  useEffect(() => {
    const token = getToken();
    if (token) {
      authAPI.me()
        .then(data => {
          setUser(data.user, token);
        })
        .catch(() => {
          setToken(null);
        });
    }
  }, [setUser]);

  const signup = useCallback(async (email: string, username: string, password: string) => {
    const data = await authAPI.signup(email, username, password);
    setUser(data.user, data.token);
    return data;
  }, [setUser]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await authAPI.login(email, password);
    setUser(data.user, data.token);
    return data;
  }, [setUser]);

  const logout = useCallback(() => {
    storeLogout();
  }, [storeLogout]);

  return {
    user,
    isAuthenticated,
    isAuthModalOpen,
    authModalTab,
    signup,
    login,
    logout,
    openAuthModal,
    closeAuthModal,
  };
}
