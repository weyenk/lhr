import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabaseClient';

interface LoginProps {
  initialError?: string | null;
}

export function Login({ initialError = null }: LoginProps = {}) {
  const [mode, setMode] = useState<'sign-in' | 'forgot-password'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(initialError);
  const [submitting, setSubmitting] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function handleSignIn(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInError) setError(signInError.message);
  }

  async function handleForgotPassword(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    setSubmitting(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setResetSent(true);
  }

  function backToSignIn() {
    setMode('sign-in');
    setError(null);
    setResetSent(false);
  }

  if (mode === 'forgot-password') {
    return (
      <div className="login-screen">
        <form onSubmit={handleForgotPassword} className="login-form">
          <h1>Reset your password</h1>
          {resetSent ? (
            <p>Check your email for a reset link.</p>
          ) : (
            <>
              <label>
                Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </label>
              {error && (
                <p role="alert" className="login-error">
                  {error}
                </p>
              )}
              <button type="submit" disabled={submitting}>
                {submitting ? 'Sending…' : 'Send reset link'}
              </button>
            </>
          )}
          <button type="button" onClick={backToSignIn}>
            Back to sign in
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <form onSubmit={handleSignIn} className="login-form">
        <h1>lhr office</h1>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && (
          <p role="alert" className="login-error">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        <button type="button" onClick={() => setMode('forgot-password')}>
          Forgot password?
        </button>
      </form>
    </div>
  );
}
