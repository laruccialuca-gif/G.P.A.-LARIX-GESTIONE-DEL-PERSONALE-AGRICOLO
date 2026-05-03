import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [hasUsers, setHasUsers] = useState(null); // null = loading
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [usersExist, user] = await Promise.all([
        window.api.auth.hasUsers(),
        window.api.auth.getCurrentUser(),
      ]);
      const normalizedHasUsers = Boolean(usersExist);
      const normalizedUser = user || null;
      setHasUsers(normalizedHasUsers);
      setCurrentUser(normalizedUser);
      console.info('[auth] refresh', {
        hasUsers: normalizedHasUsers,
        currentUserPresent: Boolean(normalizedUser),
      });
    } catch (error) {
      console.error('[auth] refresh failed', {
        message: error?.message || String(error),
      });
      setHasUsers(null);
      setCurrentUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (credentials) => {
    const user = await window.api.auth.login(credentials);
    setCurrentUser(user);
    console.info('[auth] login', {
      hasUsers: true,
      currentUserPresent: true,
    });
    return user;
  }, []);

  const loginSuperAdmin = useCallback(async (password) => {
    const user = await window.api.auth.loginSuperAdmin(password);
    setCurrentUser(user);
    console.info('[auth] login-super-admin', {
      hasUsers: true,
      currentUserPresent: true,
    });
    return user;
  }, []);

  const logout = useCallback(async () => {
    await window.api.auth.logout();
    setCurrentUser(null);
    console.info('[auth] logout', {
      hasUsers,
      currentUserPresent: false,
    });
  }, [hasUsers]);

  return (
    <AuthContext.Provider value={{ currentUser, hasUsers, loading, login, loginSuperAdmin, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
