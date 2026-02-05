'use client';

import { useRouter } from 'next/navigation';
import { FileText, Calendar, Clock, CheckCircle, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/app/components/Button';

interface Plan {
  id: string;
  goal: string;
  status: string;
  weeksDuration: number | null;
  startDate: string | null;
  createdAt: string;
  dayCount: number;
}

export function PlansContent({ plans }: { plans: Plan[] }) {
  const router = useRouter();

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-success/10 text-success text-xs font-medium">
            <CheckCircle size={12} />
            Active
          </span>
        );
      case 'draft':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted/20 text-muted text-xs font-medium">
            <Edit size={12} />
            Draft
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
            <CheckCircle size={12} />
            Completed
          </span>
        );
      default:
        return null;
    }
  };

  const formatDate = (dateString: string) => {
    // Check if it's a date-only string (YYYY-MM-DD) or ISO datetime
    if (dateString.includes('T')) {
      // ISO datetime - parse normally
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } else {
      // Date-only string - parse as local date to avoid timezone issues
      const [year, month, day] = dateString.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
  };

  const handleActivate = async (planId: string) => {
    try {
      const response = await fetch(`/api/plan/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });

      if (response.ok) {
        router.refresh();
      } else {
        console.error('Failed to activate plan');
      }
    } catch (error) {
      console.error('Error activating plan:', error);
    }
  };

  const handleDelete = async (planId: string) => {
    if (!confirm('Are you sure you want to delete this plan?')) {
      return;
    }

    try {
      const response = await fetch(`/api/plan/${planId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        router.refresh();
      } else {
        console.error('Failed to delete plan');
      }
    } catch (error) {
      console.error('Error deleting plan:', error);
    }
  };

  return (
    <div className="pb-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border">
        <div className="px-4 py-4">
          <h1 className="text-2xl font-bold text-foreground">My Plans</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {plans.length} {plans.length === 1 ? 'plan' : 'plans'}
          </p>
        </div>
      </div>

      {/* Plans List */}
      <div className="px-4 py-4 space-y-3">
        {plans.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText size={48} className="text-muted mb-4" />
            <h2 className="text-lg font-semibold text-foreground mb-2">No plans yet</h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              Create your first workout plan by chatting with the AI assistant
            </p>
            <Button onClick={() => router.push('/chat')}>
              Create Plan
            </Button>
          </div>
        ) : (
          plans.map((plan) => (
            <div
              key={plan.id}
              className="bg-surface rounded-xl p-4 border border-border hover:border-primary/50 transition-colors cursor-pointer"
              onClick={() => router.push(`/plan/${plan.id}`)}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground mb-1">{plan.goal}</h3>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar size={12} />
                      {plan.dayCount} {plan.dayCount === 1 ? 'day' : 'days'}
                    </span>
                    {plan.weeksDuration && (
                      <>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Clock size={12} />
                          {plan.weeksDuration} weeks
                        </span>
                      </>
                    )}
                  </div>
                </div>
                {getStatusBadge(plan.status)}
              </div>

              <div className="text-xs text-muted-foreground mb-4 space-y-1">
                {plan.startDate && (
                  <p>Starts {formatDate(plan.startDate)}</p>
                )}
                <p>Created {formatDate(plan.createdAt)}</p>
              </div>

              <div className="flex gap-2 justify-end">
                {plan.status !== 'active' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleActivate(plan.id);
                    }}
                  >
                    Make Active
                  </Button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(plan.id);
                  }}
                  className="p-2 rounded-lg bg-surface-elevated hover:bg-error/10 hover:text-error transition-colors"
                  title="Delete Plan"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
