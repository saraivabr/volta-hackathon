import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="login-shell">
      <div className="login-grid" aria-hidden="true" />
      <section className="login-brand">
        <div className="brand-lockup">
          <span className="brand-mark">V</span>
          <span>VOLTA / OPS</span>
        </div>
        <div>
          <p className="eyebrow">Delegated operations</p>
          <h1>Authority stays human.</h1>
          <p className="login-thesis">
            Calls become verified commitments — or they become escalations.
          </p>
        </div>
        <div className="login-principle">
          <span>01</span>
          <p>When a conversation becomes ambiguous, autonomy decreases.</p>
        </div>
      </section>
      <LoginForm />
    </main>
  );
}

