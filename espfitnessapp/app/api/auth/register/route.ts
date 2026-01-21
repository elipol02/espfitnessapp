import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { hashPassword } from '@/app/lib/auth';

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  name: z.string().min(1, 'Name is required').optional(),
  systemPassword: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = registerSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error.issues[0].message },
        { status: 400 }
      );
    }

    const { email, password, name, systemPassword } = result.data;

    // Verify system password when SYSTEM_PASSWORD is set in env
    const expectedSystemPassword = process.env.SYSTEM_PASSWORD;
    if (expectedSystemPassword) {
      const given = systemPassword ?? '';
      try {
        const a = Buffer.from(given, 'utf8');
        const b = Buffer.from(expectedSystemPassword, 'utf8');
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return NextResponse.json(
            { success: false, error: 'Invalid system password' },
            { status: 400 }
          );
        }
      } catch {
        return NextResponse.json(
          { success: false, error: 'Invalid system password' },
          { status: 400 }
        );
      }
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { success: false, error: 'An account with this email already exists' },
        { status: 400 }
      );
    }

    // Hash password and create user
    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        onboardingCompleted: false,
      },
    });

    // Create initial user stats
    await prisma.userStats.create({
      data: {
        userId: user.id,
        currentStreak: 0,
        longestStreak: 0,
        personalRecords: {},
        progressPercentage: 0,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create account' },
      { status: 500 }
    );
  }
}
