// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent } from "@/test/dom";

const { push, refresh, signInEmail, signInSocial, signUpEmail } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  signInEmail: vi.fn(),
  signInSocial: vi.fn(),
  signUpEmail: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/lib/auth/client", () => ({
  signIn: { email: signInEmail, social: signInSocial },
  signUp: { email: signUpEmail },
}));

import { CredentialsForm } from "./credentials-form";

const DOCUMENTS = [
  { key: "terms_of_service", title: "Terms of Service", version: "0.1", href: "https://x/terms" },
  { key: "privacy_policy", title: "Privacy Policy", version: "0.1", href: "https://x/privacy" },
];
const ACCEPTANCE = {
  documents: { terms_of_service: "0.1", privacy_policy: "0.1" },
  eligible: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  signUpEmail.mockResolvedValue({ error: null });
  signInSocial.mockResolvedValue(undefined);
});

async function fillCredentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "new@example.com");
  await user.type(screen.getByLabelText("Password"), "a-long-password");
}

async function acceptAll(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("checkbox", { name: /I agree to the/ }));
  await user.click(screen.getByRole("checkbox", { name: /United States/ }));
}

describe("hosted sign-up clickwrap", () => {
  it("links each document and asks for the eligibility statement", () => {
    render(<CredentialsForm clickwrap={DOCUMENTS} mode="sign-up" />);

    expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveProperty(
      "href",
      "https://x/terms",
    );
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveProperty(
      "href",
      "https://x/privacy",
    );
    expect(screen.getByRole("checkbox", { name: /18 or older/ })).toBeTruthy();
  });

  it("refuses to create an account until both statements are accepted", async () => {
    const user = userEvent.setup();
    render(<CredentialsForm clickwrap={DOCUMENTS} mode="sign-up" />);

    await fillCredentials(user);
    await user.click(screen.getByRole("checkbox", { name: /I agree to the/ }));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(signUpEmail).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/18 or older/);
  });

  it("sends the accepted versions with the sign-up", async () => {
    const user = userEvent.setup();
    render(<CredentialsForm clickwrap={DOCUMENTS} mode="sign-up" />);

    await fillCredentials(user);
    await acceptAll(user);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(signUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@example.com", legalAcceptance: ACCEPTANCE }),
    );
  });

  it("offers GitHub sign-up only after acceptance, and carries it through OAuth", async () => {
    const user = userEvent.setup();
    render(<CredentialsForm clickwrap={DOCUMENTS} githubEnabled mode="sign-up" />);
    const github = screen.getByRole("button", { name: "Sign up with GitHub" });

    expect(github).toHaveProperty("disabled", true);
    await acceptAll(user);
    await user.click(github);

    expect(signInSocial).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "github",
        additionalData: { legalAcceptance: ACCEPTANCE },
      }),
    );
  });

  it("shows no clickwrap on sign-in or a self-hosted sign-up", () => {
    const { unmount } = render(<CredentialsForm githubEnabled mode="sign-in" />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    unmount();

    render(<CredentialsForm mode="sign-up" />);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
