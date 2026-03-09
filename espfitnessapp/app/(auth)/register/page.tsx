'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/app/components/Button';

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [systemPassword, setSystemPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showCommitmentModal, setShowCommitmentModal] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      // Register the user
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name, systemPassword }),
      });

      const data = await response.json();

      if (!data.success) {
        setError(data.error || 'Failed to create account');
        return;
      }

      // Sign in the user
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError('Account created but failed to sign in. Please try logging in.');
      } else {
        setShowCommitmentModal(true);
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCommitmentConfirm = () => {
    router.push('/chat');
    router.refresh();
  };

  return (
    <>
      {showCommitmentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div className="relative w-full max-w-sm bg-surface border border-border rounded-2xl p-8 space-y-6 shadow-2xl">
            <div className="space-y-3 text-center">
              <div className="text-4xl">💪</div>
              <h2 className="text-2xl font-bold text-foreground leading-tight">
                One thing before you start
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                This app is built for people who make workout plans and commit to them —{' '}
                <span className="text-foreground font-medium">100%</span>. No excuses, no skipping, no "I'll start Monday."
              </p>
              <p className="text-muted-foreground leading-relaxed">
                If that's not you, this isn't the right place.
              </p>
            </div>
            <Button
              fullWidth
              size="lg"
              onClick={handleCommitmentConfirm}
            >
              That's me — let's go
            </Button>
          </div>
        </div>
      )}
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 bg-background">
      <div className="w-full max-w-sm space-y-10">
        {/* Logo/Header */}
        <div className="text-center">
          <h1 className="text-3xl font-bold text-foreground">ESP Fitness</h1>
          <p className="mt-2 text-muted-foreground">Create your account</p>
        </div>

        {/* Register Form */}
        <form onSubmit={handleSubmit} className="space-y-8">
          {error && (
            <div className="p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-foreground mb-1.5"
              >
                Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                className="w-full px-4 py-3 rounded-lg bg-surface border border-border 
                         text-foreground placeholder-muted
                         focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent
                         transition-colors"
                placeholder="Your name"
              />
            </div>

            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-foreground mb-1.5"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-4 py-3 rounded-lg bg-surface border border-border 
                         text-foreground placeholder-muted
                         focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent
                         transition-colors"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-foreground mb-1.5"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                minLength={6}
                className="w-full px-4 py-3 rounded-lg bg-surface border border-border 
                         text-foreground placeholder-muted
                         focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent
                         transition-colors"
                placeholder="••••••••"
              />
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-foreground mb-1.5"
              >
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                minLength={6}
                className="w-full px-4 py-3 rounded-lg bg-surface border border-border 
                         text-foreground placeholder-muted
                         focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent
                         transition-colors"
                placeholder="••••••••"
              />
            </div>

            <div>
              <label
                htmlFor="systemPassword"
                className="block text-sm font-medium text-foreground mb-1.5"
              >
                System Password (optional)
              </label>
              <input
                id="systemPassword"
                type="password"
                value={systemPassword}
                onChange={(e) => setSystemPassword(e.target.value)}
                autoComplete="off"
                className="w-full px-4 py-3 rounded-lg bg-surface border border-border 
                         text-foreground placeholder-muted
                         focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent
                         transition-colors"
                placeholder="Enter system password"
              />
            </div>
          </div>

          <Button
            type="submit"
            fullWidth
            size="lg"
            loading={loading}
            disabled={loading}
          >
            Create Account
          </Button>
        </form>

        {/* Login Link */}
        <p className="text-center text-muted-foreground">
          Already have an account?{' '}
          <Link
            href="/login"
            className="text-primary hover:text-primary-hover font-medium transition-colors"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
    </>
  );
}
