import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/app/lib/auth';
import { computeSuggestions } from '@/app/lib/progression';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ workoutTypeId: string }> }
) {
  try {
    const { session, error } = await validateSession();
    if (error || !session?.user?.id) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 });
    }

    const { workoutTypeId } = await params;
    const suggestions = await computeSuggestions(workoutTypeId, session.user.id);

    return NextResponse.json({ success: true, data: suggestions });
  } catch (error) {
    console.error('Error computing progression suggestions:', error);
    return NextResponse.json({ success: false, error: 'Failed to compute suggestions' }, { status: 500 });
  }
}
