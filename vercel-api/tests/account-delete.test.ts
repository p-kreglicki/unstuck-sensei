const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

import accountDeleteRoute, {
  handleDeleteAccountRequest,
} from "../api/account/delete.js";

describe("account delete route", () => {
  beforeEach(() => {
    process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    createClientMock.mockReset();
  });

  afterEach(() => {
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_URL;
  });

  it("returns 401 when the authorization header is missing", async () => {
    const response = await handleDeleteAccountRequest(
      new Request("https://example.com/api/account/delete", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("returns 405 for non-POST requests", async () => {
    const response = await accountDeleteRoute.fetch(
      new Request("https://example.com/api/account/delete", {
        method: "GET",
      }),
    );

    expect(response.status).toBe(405);
  });

  it("returns 401 when the bearer token does not map to a user", async () => {
    createClientMock.mockReturnValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: null,
          },
          error: new Error("invalid jwt"),
        }),
      },
    });

    const response = await handleDeleteAccountRequest(
      new Request("https://example.com/api/account/delete", {
        headers: {
          Authorization: "Bearer token-123",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(createClientMock).toHaveBeenCalledTimes(1);
  });

  it("deletes the verified user id and ignores request body ids", async () => {
    const revokeRefreshTokens = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    });
    const deleteUser = vi.fn().mockResolvedValue({
      data: {
        user: null,
      },
      error: null,
    });

    createClientMock
      .mockReturnValueOnce({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: "verified-user-id",
              },
            },
            error: null,
          }),
        },
      })
      .mockReturnValueOnce({
        auth: {
          admin: {
            signOut: revokeRefreshTokens,
            deleteUser,
          },
        },
      });

    const response = await handleDeleteAccountRequest(
      new Request("https://example.com/api/account/delete", {
        body: JSON.stringify({
          userId: "untrusted-body-id",
        }),
        headers: {
          Authorization: "Bearer token-123",
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(204);
    expect(revokeRefreshTokens).toHaveBeenCalledWith("token-123", "global");
    expect(deleteUser).toHaveBeenCalledWith("verified-user-id");
    expect(revokeRefreshTokens.mock.invocationCallOrder[0]).toBeLessThan(
      deleteUser.mock.invocationCallOrder[0],
    );
    expect(createClientMock).toHaveBeenCalledTimes(2);
  });

  it("returns 500 when refresh-token revocation fails", async () => {
    const revokeRefreshTokens = vi.fn().mockResolvedValue({
      data: null,
      error: new Error("revoke failed"),
    });
    const deleteUser = vi.fn();

    createClientMock
      .mockReturnValueOnce({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: "verified-user-id",
              },
            },
            error: null,
          }),
        },
      })
      .mockReturnValueOnce({
        auth: {
          admin: {
            signOut: revokeRefreshTokens,
            deleteUser,
          },
        },
      });

    const response = await handleDeleteAccountRequest(
      new Request("https://example.com/api/account/delete", {
        headers: {
          Authorization: "Bearer token-123",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(500);
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
