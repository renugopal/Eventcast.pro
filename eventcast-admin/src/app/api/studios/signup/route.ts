import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'edge';

export async function POST(req: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: 'Server configuration error: Admin client not initialized' },
      { status: 500 }
    );
  }

  try {
    const { email, password, studioName, slug, brandColorHex } = await req.json();

    // 1. Validation
    if (!email || !password || !studioName || !slug) {
      return NextResponse.json(
        { error: 'Please fill in all required fields' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters long' },
        { status: 400 }
      );
    }

    // Validate slug format: alphanumeric and hyphens only
    const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    if (!slugRegex.test(slug)) {
      return NextResponse.json(
        { error: 'Slug must be lowercase, alphanumeric, and can contain hyphens (e.g. "my-studio")' },
        { status: 400 }
      );
    }

    // Reserved words check
    const reservedSlugs = ['api', 'login', 'signup', 'portal', 'events', 'admin', 'cron', 'media'];
    if (reservedSlugs.includes(slug)) {
      return NextResponse.json(
        { error: 'This studio slug is reserved. Please choose a different one.' },
        { status: 400 }
      );
    }

    // 2. Check if slug is already taken
    const { data: existingStudio, error: checkError } = await supabaseAdmin
      .from('studios')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();

    if (checkError) {
      return NextResponse.json(
        { error: 'Database error while checking slug availability' },
        { status: 500 }
      );
    }

    if (existingStudio) {
      return NextResponse.json(
        { error: 'This studio slug is already taken. Please choose a different one.' },
        { status: 400 }
      );
    }

    // 3. Create the user in Supabase Auth (Auto-confirm email)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (authError || !authData.user) {
      return NextResponse.json(
        { error: authError?.message || 'Failed to create user account' },
        { status: 400 }
      );
    }

    const userId = authData.user.id;

    // 4. Create the Studio profile
    const { data: studioData, error: studioError } = await supabaseAdmin
      .from('studios')
      .insert({
        owner_user_id: userId,
        slug,
        display_name: studioName,
        brand_color_hex: brandColorHex || '#2563eb',
        plan_tier: 'free_trial'
      })
      .select()
      .single();

    if (studioError || !studioData) {
      // Rollback: delete the created auth user
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return NextResponse.json(
        { error: studioError?.message || 'Failed to create studio profile' },
        { status: 500 }
      );
    }

    // 5. Establish Studio Membership (Role: owner)
    const { error: memberError } = await supabaseAdmin
      .from('studio_members')
      .insert({
        studio_id: studioData.id,
        user_id: userId,
        role: 'owner'
      });

    if (memberError) {
      // Rollback: delete both the studio profile and the auth user
      await supabaseAdmin.from('studios').delete().eq('id', studioData.id);
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return NextResponse.json(
        { error: memberError.message || 'Failed to establish studio ownership' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      userId,
      studioId: studioData.id,
      slug: studioData.slug,
      message: 'Studio registered successfully! You can now log in.'
    });

  } catch (error: any) {
    console.error('Studio Signup API Error:', error);
    return NextResponse.json(
      { error: 'An unexpected server error occurred: ' + error.message },
      { status: 500 }
    );
  }
}
