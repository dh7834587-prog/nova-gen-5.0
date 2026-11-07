import { useState } from "react";
import { errorMessage } from "../api.js";
import { useRouter } from "../router.js";
import { useSession } from "../session.js";
import { FacebookMark, GoogleMark, Icon } from "../components/Icons.js";
import { Button, Field, Input, Notice } from "../components/ui.js";

type Mode = "login" | "register";

const FEATURES = [
  "Private per-account workspaces",
  "Assistant, memory, research and files",
  "Owner-approved plans and permissions",
];

export function AuthPage({ mode: initialMode = "login" }: { mode?: Mode }) {
  const { login, register, providers } = useSession();
  const { navigate } = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "register") await register(name, email, password);
      else await login(email, password);
      navigate("/app");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <aside className="auth-aside">
        <div className="auth-brand">
          <span className="brand-mark">N</span>
          <div>
            <strong>NOVA GEN 5.0</strong>
            <span>Personal AI operating system</span>
          </div>
        </div>
        <h1>
          One private workspace for <span className="grad-text">thinking, making and shipping</span>.
        </h1>
        <p>
          Fifteen modules behind a single session. Your conversations, memories, projects and files are stored
          against your account — never mixed with another user's.
        </p>
        <ul className="auth-features">
          {FEATURES.map((feature) => (
            <li key={feature}>
              <Icon name="check" size={16} />
              {feature}
            </li>
          ))}
        </ul>
        <div className="auth-orbits" aria-hidden="true">
          <span className="orbit-ring" />
          <span className="orbit-ring orbit-ring-2" />
        </div>
      </aside>

      <main className="auth-card panel">
        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={mode === "login" ? "is-active" : ""}
            onClick={() => {
              setMode("login");
              setError(null);
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            className={mode === "register" ? "is-active" : ""}
            onClick={() => {
              setMode("register");
              setError(null);
            }}
          >
            Create account
          </button>
        </div>

        <form className="stack-tight" onSubmit={submit}>
          {mode === "register" ? (
            <Field label="Name">
              <Input
                value={name}
                autoComplete="name"
                required
                minLength={2}
                placeholder="Ada Nwosu"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          ) : null}
          <Field label="Email">
            <Input
              type="email"
              value={email}
              autoComplete="email"
              required
              placeholder="you@example.com"
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field
            label="Password"
            hint={mode === "register" ? "At least 10 characters with a letter and a number." : undefined}
          >
            <Input
              type="password"
              value={password}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              required
              placeholder="••••••••••"
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          {error ? (
            <Notice tone="danger" title="Sign-in failed">
              {error}
            </Notice>
          ) : null}

          <Button type="submit" loading={busy} className="full">
            {mode === "register" ? "Create account" : "Sign in"}
          </Button>
        </form>

        <div className="auth-divider">
          <span>or continue with</span>
        </div>

        <div className="social-row">
          {(["google", "facebook"] as const).map((provider) => {
            const status = providers.find((item) => item.provider === provider);
            const configured = Boolean(status?.configured);
            return (
              <a
                key={provider}
                className={`btn btn-ghost social-btn ${configured ? "" : "is-disabled"}`}
                href={configured ? `/api/auth/oauth/${provider}/start` : undefined}
                aria-disabled={!configured}
                title={
                  configured
                    ? `Continue with ${provider === "google" ? "Google" : "Facebook"}`
                    : (status?.reason ?? `${provider} sign-in is not configured on this server.`)
                }
                onClick={(event) => {
                  if (!configured) event.preventDefault();
                }}
              >
                {provider === "google" ? <GoogleMark /> : <FacebookMark />}
                <span>{provider === "google" ? "Google" : "Facebook"}</span>
              </a>
            );
          })}
        </div>
        <p className="muted small">
          Social sign-in activates as soon as the owner adds OAuth credentials for this server. Until then the
          buttons stay disabled rather than simulating a login.
        </p>
      </main>
    </div>
  );
}
