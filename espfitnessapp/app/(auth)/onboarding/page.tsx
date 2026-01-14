'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/components/Button';

type Step = 'welcome' | 'goal' | 'details';

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('welcome');
  const [goal, setGoal] = useState('');
  const [bodyweight, setBodyweight] = useState('');
  const [loading, setLoading] = useState(false);

  const handleComplete = async () => {
    setLoading(true);

    try {
      // Update user profile with onboarding data
      await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bodyweight: bodyweight ? parseFloat(bodyweight) : null,
          onboardingCompleted: true,
        }),
      });

      // If user entered a goal, redirect to chat to create plan
      if (goal.trim()) {
        // Store goal in session/localStorage for chat to pick up
        sessionStorage.setItem('initialGoal', goal);
        router.push('/chat/create');
      } else {
        router.push('/home');
      }
      router.refresh();
    } catch (error) {
      console.error('Onboarding error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 bg-background">
      <div className="w-full max-w-md space-y-10">
        {/* Step: Welcome */}
        {step === 'welcome' && (
          <div className="space-y-8 animate-fade-in">
            <div className="text-center space-y-4">
              <div className="text-6xl">💪</div>
              <h1 className="text-3xl font-bold text-foreground">
                Welcome to ESP Fitness
              </h1>
              <p className="text-muted-foreground text-lg">
                Your AI-powered fitness coach is ready to help you reach your goals.
              </p>
            </div>

            <div className="space-y-4 text-center">
              <div className="flex items-center justify-center gap-3 text-foreground">
                <span className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-sm font-bold">1</span>
                <span>Tell us your fitness goal</span>
              </div>
              <div className="flex items-center justify-center gap-3 text-foreground">
                <span className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-sm font-bold">2</span>
                <span>AI creates your personalized plan</span>
              </div>
              <div className="flex items-center justify-center gap-3 text-foreground">
                <span className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-sm font-bold">3</span>
                <span>Track workouts and progress</span>
              </div>
            </div>

            <Button
              onClick={() => setStep('goal')}
              fullWidth
              size="lg"
            >
              Get Started
            </Button>
          </div>
        )}

        {/* Step: Goal */}
        {step === 'goal' && (
          <div className="space-y-6 animate-fade-in">
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-foreground">
                What&apos;s your fitness goal?
              </h2>
              <p className="text-muted-foreground">
                Tell us what you want to achieve. Be specific!
              </p>
            </div>

            <div className="space-y-4">
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="e.g., Hit a 225lb bench press, lose 20 pounds, run a 5K..."
                rows={4}
                className="w-full px-4 py-3 rounded-lg bg-surface border border-border 
                         text-foreground placeholder-muted resize-none
                         focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent
                         transition-colors"
              />

              <div className="flex flex-wrap gap-2">
                {['Build muscle', 'Lose weight', 'Get stronger', 'Improve endurance'].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setGoal(goal ? `${goal}, ${suggestion.toLowerCase()}` : suggestion)}
                    className="px-3 py-1.5 rounded-full bg-surface border border-border 
                             text-sm text-muted-foreground hover:text-foreground hover:border-primary
                             transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                onClick={() => setStep('welcome')}
                variant="secondary"
                size="lg"
                className="flex-1"
              >
                Back
              </Button>
              <Button
                onClick={() => setStep('details')}
                size="lg"
                className="flex-1"
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {/* Step: Details */}
        {step === 'details' && (
          <div className="space-y-6 animate-fade-in">
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-foreground">
                One more thing
              </h2>
              <p className="text-muted-foreground">
                This helps us calculate weights for your exercises.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="bodyweight"
                  className="block text-sm font-medium text-foreground mb-1.5"
                >
                  Current bodyweight (lbs) - Optional
                </label>
                <input
                  id="bodyweight"
                  type="number"
                  value={bodyweight}
                  onChange={(e) => setBodyweight(e.target.value)}
                  placeholder="e.g., 175"
                  className="w-full px-4 py-3 rounded-lg bg-surface border border-border 
                           text-foreground placeholder-muted
                           focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent
                           transition-colors"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                onClick={() => setStep('goal')}
                variant="secondary"
                size="lg"
                className="flex-1"
              >
                Back
              </Button>
              <Button
                onClick={handleComplete}
                size="lg"
                loading={loading}
                className="flex-1"
              >
                {goal.trim() ? 'Create My Plan' : 'Finish'}
              </Button>
            </div>

            <button
              onClick={handleComplete}
              className="w-full text-center text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              Skip for now
            </button>
          </div>
        )}

        {/* Progress dots */}
        <div className="flex justify-center gap-2">
          {(['welcome', 'goal', 'details'] as Step[]).map((s) => (
            <div
              key={s}
              className={`w-2 h-2 rounded-full transition-colors ${
                step === s ? 'bg-primary' : 'bg-border'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
