"use client";

import { useCallback, useEffect, useState } from "react";

export type ClientSession = {
  userId: number;
  username: string;
};

export function useAuthSession() {
  const [session, setSession] = useState<ClientSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      const data = (await response.json()) as { session?: ClientSession | null };
      setSession(response.ok ? data.session ?? null : null);
    } catch {
      setSession(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  return {
    session,
    isLoading,
    refreshSession,
    setSession,
  };
}
