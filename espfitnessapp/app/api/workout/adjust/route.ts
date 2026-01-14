import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/app/lib/auth';
import { applyAdaptiveAdjustments, updateProgressPercentage } from '@/app/lib/adaptive';

// GET - Get suggested adjustments for the active plan
export async function GET(request: NextRequest) {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const planId = searchParams.get('planId');

    if (!planId) {
      return NextResponse.json(
        { success: false, error: 'Plan ID required' },
        { status: 400 }
      );
    }

    const suggestions = await applyAdaptiveAdjustments(session.user.id, planId);
    
    // Also update progress percentage
    await updateProgressPercentage(session.user.id);

    return NextResponse.json({
      success: true,
      data: { suggestions },
    });
  } catch (error) {
    console.error('Get adjustments error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get adjustments' },
      { status: 500 }
    );
  }
}
