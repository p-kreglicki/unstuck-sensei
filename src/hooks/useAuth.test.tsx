import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { AuthProvider, useAuth } from "./useAuth";

const {
  enableAutostartMock,
  getSessionMock,
  onAuthStateChangeMock,
  signInWithPasswordMock,
  signOutMock,
  signUpMock,
} = vi.hoisted(() => ({
  enableAutostartMock: vi.fn(),
  getSessionMock: vi.fn(),
  onAuthStateChangeMock: vi.fn(),
  signInWithPasswordMock: vi.fn(),
  signOutMock: vi.fn(),
  signUpMock: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-autostart", () => ({
  enable: (...args: unknown[]) => enableAutostartMock(...args),
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      onAuthStateChange: (...args: unknown[]) => onAuthStateChangeMock(...args),
      signInWithPassword: (...args: unknown[]) => signInWithPasswordMock(...args),
      signOut: (...args: unknown[]) => signOutMock(...args),
      signUp: (...args: unknown[]) => signUpMock(...args),
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe("useAuth", () => {
  let authStateChangeHandler:
    | ((event: string, nextSession: Session | null) => void)
    | null = null;
  let unsubscribeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    authStateChangeHandler = null;
    unsubscribeMock = vi.fn();

    getSessionMock.mockResolvedValue({
      data: {
        session: null,
      },
      error: null,
    });
    onAuthStateChangeMock.mockImplementation((callback: unknown) => {
      authStateChangeHandler = callback as (event: string, nextSession: Session | null) => void;

      return {
        data: {
          subscription: {
            unsubscribe: unsubscribeMock,
          },
        },
      };
    });
    signInWithPasswordMock.mockResolvedValue({
      error: null,
    });
    signOutMock.mockResolvedValue({
      error: null,
    });
    signUpMock.mockResolvedValue({
      error: null,
    });
    enableAutostartMock.mockResolvedValue(undefined);
  });

  it("keeps auth action identities stable across loading and session changes", async () => {
    const { result, unmount } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const initialCancelAccountDeletion = result.current.cancelAccountDeletion;
    const initialFinishAccountDeletion = result.current.finishAccountDeletion;
    const initialSignIn = result.current.signIn;
    const initialSignOut = result.current.signOut;
    const initialSignUp = result.current.signUp;
    const initialStartAccountDeletion = result.current.startAccountDeletion;

    await act(async () => {
      await result.current.signIn("founder@example.com", "secret-123");
    });

    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: "founder@example.com",
      password: "secret-123",
    });
    expect(enableAutostartMock).toHaveBeenCalledTimes(1);
    expect(result.current.cancelAccountDeletion).toBe(initialCancelAccountDeletion);
    expect(result.current.finishAccountDeletion).toBe(initialFinishAccountDeletion);
    expect(result.current.signIn).toBe(initialSignIn);
    expect(result.current.signOut).toBe(initialSignOut);
    expect(result.current.signUp).toBe(initialSignUp);
    expect(result.current.startAccountDeletion).toBe(initialStartAccountDeletion);

    const nextSession = {
      access_token: "token-123",
      expires_at: 1_900_000_000,
      expires_in: 3600,
      refresh_token: "refresh-123",
      token_type: "bearer",
      user: {
        app_metadata: {},
        aud: "authenticated",
        created_at: "2026-03-22T00:00:00.000Z",
        id: "user-1",
        user_metadata: {},
      },
    } as Session;

    await act(async () => {
      authStateChangeHandler?.("SIGNED_IN", nextSession);
      await Promise.resolve();
    });

    expect(result.current.session).toBe(nextSession);
    expect(result.current.user?.id).toBe("user-1");
    expect(result.current.cancelAccountDeletion).toBe(initialCancelAccountDeletion);
    expect(result.current.finishAccountDeletion).toBe(initialFinishAccountDeletion);
    expect(result.current.signIn).toBe(initialSignIn);
    expect(result.current.signOut).toBe(initialSignOut);
    expect(result.current.signUp).toBe(initialSignUp);
    expect(result.current.startAccountDeletion).toBe(initialStartAccountDeletion);

    unmount();

    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });
});
