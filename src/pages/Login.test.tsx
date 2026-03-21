import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Login } from "./Login";

const { useAuthMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => useAuthMock(),
}));

describe("Login", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("announces sign-in failures as alerts", async () => {
    const signIn = vi.fn().mockResolvedValue({
      error: new Error("Invalid credentials"),
    });

    useAuthMock.mockReturnValue({
      isLoading: false,
      session: null,
      signIn,
      signUp: vi.fn(),
    });

    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "founder@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "secret123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid credentials");
    });
  });

  it("announces successful sign-up with status semantics", async () => {
    const signUp = vi.fn().mockResolvedValue({
      error: null,
    });

    useAuthMock.mockReturnValue({
      isLoading: false,
      session: null,
      signIn: vi.fn(),
      signUp,
    });

    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "sign up" }));
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "founder@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "secret123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Account created. Sign in with your new credentials to enter the app.",
      );
    });
  });
});
