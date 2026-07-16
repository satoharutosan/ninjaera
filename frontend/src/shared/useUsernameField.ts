import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/app/api";
import { validateUsernameClient, USERNAME_FORMAT_ERROR, USERNAME_TAKEN_ERROR } from "@/shared/username";

const AVAILABILITY_DEBOUNCE_MS = 400;

type Options = {
  /** When checking availability while editing an existing user. */
  excludeUserId?: number;
};

/**
 * Shared username field state: local format validation + debounced availability check.
 */
export function useUsernameField(initial = "", options: Options = {}) {
  const [value, setValueState] = useState(initial);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);
  const excludeRef = useRef(options.excludeUserId);
  excludeRef.current = options.excludeUserId;

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const setValue = useCallback((next: string) => {
    setValueState(next);
    const local = validateUsernameClient(next);
    if (!local.ok) {
      setError(local.error);
      clearTimer();
      setChecking(false);
      return;
    }
    setError("");
    clearTimer();
    setChecking(true);
    const seq = ++reqIdRef.current;
    timerRef.current = setTimeout(async () => {
      try {
        const r = await api.auth.usernameAvailable(local.username, excludeRef.current);
        if (seq !== reqIdRef.current) return;
        if (!r.available) {
          setError(r.error || (r.reason === "invalid" ? USERNAME_FORMAT_ERROR : USERNAME_TAKEN_ERROR));
        } else {
          setError("");
        }
      } catch {
        if (seq !== reqIdRef.current) return;
      } finally {
        if (seq === reqIdRef.current) setChecking(false);
      }
    }, AVAILABILITY_DEBOUNCE_MS);
  }, []);

  useEffect(() => () => clearTimer(), []);

  const reset = useCallback((next = "") => {
    clearTimer();
    setValueState(next);
    setError("");
    setChecking(false);
  }, []);

  /** Validates format + availability. Returns error message or null on success. */
  const validateBeforeSubmit = useCallback(async (): Promise<string | null> => {
    clearTimer();
    const local = validateUsernameClient(value);
    if (!local.ok) {
      setError(local.error);
      return local.error;
    }
    try {
      const r = await api.auth.usernameAvailable(local.username, excludeRef.current);
      if (!r.available) {
        const msg = r.error || USERNAME_TAKEN_ERROR;
        setError(msg);
        return msg;
      }
      setError("");
      return null;
    } catch {
      setError("");
      return null;
    }
  }, [value]);

  return {
    value,
    setValue,
    error,
    setError,
    checking,
    reset,
    validateBeforeSubmit,
    getTrimmed: () => {
      const local = validateUsernameClient(value);
      return local.ok ? local.username : null;
    },
  };
}
