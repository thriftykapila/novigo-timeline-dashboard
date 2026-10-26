import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, tokenStorage } from "../lib/api";
import type { User } from "../lib/types";

interface AuthState {
  user: User | null;
  restoring: boolean;
  restoreError: string;
  expired: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  retryRestore: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState("");
  const [expired, setExpired] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const queryClient = useQueryClient();
  const operationVersion = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  const beginOperation = useCallback(() => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    return { version: ++operationVersion.current, controller };
  }, []);

  useEffect(() => {
    const { version, controller } = beginOperation();

    async function restore() {
      setRestoring(true);
      setRestoreError("");
      if (!tokenStorage.get()) {
        setUser(null);
        setRestoring(false);
        return;
      }
      try {
        const profile = await api.me(controller.signal);
        if (
          !controller.signal.aborted &&
          operationVersion.current === version
        ) {
          setUser(profile);
        }
      } catch (error) {
        if (
          !controller.signal.aborted &&
          operationVersion.current === version &&
          tokenStorage.get()
        ) {
          setRestoreError(
            error instanceof Error
              ? error.message
              : "Could not validate your session.",
          );
        }
      } finally {
        if (
          !controller.signal.aborted &&
          operationVersion.current === version
        ) {
          setRestoring(false);
        }
      }
    }

    void restore();
    return () => controller.abort();
  }, [restoreAttempt, beginOperation]);

  useEffect(() => {
    const handleSessionExpired = () => {
      ++operationVersion.current;
      activeRequest.current?.abort();
      setUser(null);
      setExpired(true);
      setRestoreError("");
      setRestoring(false);
      queryClient.clear();
    };
    window.addEventListener("novigo:session-expired", handleSessionExpired);
    return () =>
      window.removeEventListener(
        "novigo:session-expired",
        handleSessionExpired,
      );
  }, [queryClient]);

  useEffect(
    () => () => {
      ++operationVersion.current;
      activeRequest.current?.abort();
    },
    [],
  );

  const signIn = useCallback(
    async (username: string, password: string) => {
      const { version, controller } = beginOperation();
      let signedInToken: string | null = null;
      try {
        const session = await api.login(username, password, controller.signal);
        signedInToken = session.access_token;
        const profile = await api.me(controller.signal);
        if (
          controller.signal.aborted ||
          operationVersion.current !== version ||
          tokenStorage.get() !== signedInToken
        ) {
          throw new DOMException("Request cancelled", "AbortError");
        }

        setExpired(false);
        setRestoreError("");
        setRestoring(false);
        setUser(profile);
      } catch (error) {
        if (
          operationVersion.current === version &&
          signedInToken &&
          tokenStorage.get() === signedInToken
        ) {
          tokenStorage.clear();
        }
        throw error;
      }
    },
    [beginOperation],
  );

  const signOut = useCallback(async () => {
    const { version } = beginOperation();
    try {
      await api.logout();
    } finally {
      if (operationVersion.current === version) {
        tokenStorage.clear();
        queryClient.clear();
        setUser(null);
        setExpired(false);
        setRestoreError("");
        setRestoring(false);
      }
    }
  }, [queryClient, beginOperation]);

  return (
    <AuthContext.Provider
      value={{
        user,
        restoring,
        restoreError,
        expired,
        signIn,
        signOut,
        retryRestore: () => setRestoreAttempt((attempt) => attempt + 1),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is required");
  return value;
}
