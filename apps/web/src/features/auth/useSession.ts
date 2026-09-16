import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase.js";

interface SessionState {
  session: Session | null;
  /** True only until the first auth state is known — never true again after that, so a token
   *  refresh or sign-out doesn't flash a loading screen (AC-AUTH-08: session survives reload). */
  loading: boolean;
}

/** The one place the app reads auth state from. Wraps `getSession` (for the very first render)
 *  and `onAuthStateChange` (for every change after that — sign-in, sign-out, token refresh). */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ session: null, loading: true });

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setState({ session: data.session, loading: false });
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) setState({ session, loading: false });
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return state;
}
