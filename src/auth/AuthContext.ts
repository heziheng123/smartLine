import { createContext, useContext } from 'react';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';

export interface AuthContextValue {
  enabled: boolean;
  login?: string;
  userId?: string;
  logout: () => Promise<void>;
  retry: () => void;
  status: AuthStatus;
}

export const AuthContext = createContext<AuthContextValue>({
  enabled: false,
  logout: async () => undefined,
  retry: () => undefined,
  status: 'authenticated',
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
