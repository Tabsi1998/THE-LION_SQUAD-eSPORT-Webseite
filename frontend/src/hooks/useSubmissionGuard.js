import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Runs at most one form submission at a time.
 *
 * The ref is updated synchronously, unlike React state, so two submit events in
 * the same render cycle cannot start duplicate requests. State remains the
 * public UI signal for disabled/loading feedback.
 */
export function useSubmissionGuard() {
  const lockedRef = useRef(false);
  const mountedRef = useRef(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const submitOnce = useCallback(async (task) => {
    if (lockedRef.current) return { started: false };
    lockedRef.current = true;
    setSubmitting(true);
    try {
      return { started: true, value: await task() };
    } catch (error) {
      return { started: true, error };
    } finally {
      lockedRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  }, []);

  return { submitting, submitOnce };
}
