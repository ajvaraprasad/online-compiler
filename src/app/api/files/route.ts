import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';

// GET /api/files - Get all files for the authenticated user
export async function GET(request: NextRequest) {
  try {
    const authUser = getUserFromRequest(request);
    if (!authUser) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const files = await db.codeFile.findMany({
      where: { userId: authUser.userId },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json({ files });
  } catch (error) {
    console.error('Get files error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/files - Create a new file
export async function POST(request: NextRequest) {
  try {
    const authUser = getUserFromRequest(request);
    if (!authUser) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { name, language, content } = body;

    if (!name || !language) {
      return NextResponse.json(
        { error: 'Name and language are required' },
        { status: 400 }
      );
    }

    const file = await db.codeFile.create({
      data: {
        name,
        language,
        content: content || '',
        userId: authUser.userId,
      },
    });

    return NextResponse.json({ file }, { status: 201 });
  } catch (error) {
    console.error('Create file error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT /api/files - Update a file
export async function PUT(request: NextRequest) {
  try {
    const authUser = getUserFromRequest(request);
    if (!authUser) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { id, name, language, content } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'File ID is required' },
        { status: 400 }
      );
    }

    const existingFile = await db.codeFile.findUnique({
      where: { id },
    });

    if (!existingFile) {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      );
    }

    if (existingFile.userId !== authUser.userId) {
      return NextResponse.json(
        { error: 'Not authorized to update this file' },
        { status: 403 }
      );
    }

    const updateData: { name?: string; language?: string; content?: string } = {};
    if (name !== undefined) updateData.name = name;
    if (language !== undefined) updateData.language = language;
    if (content !== undefined) updateData.content = content;

    const file = await db.codeFile.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ file });
  } catch (error) {
    console.error('Update file error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/files - Delete a file
export async function DELETE(request: NextRequest) {
  try {
    const authUser = getUserFromRequest(request);
    if (!authUser) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'File ID is required' },
        { status: 400 }
      );
    }

    const existingFile = await db.codeFile.findUnique({
      where: { id },
    });

    if (!existingFile) {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      );
    }

    if (existingFile.userId !== authUser.userId) {
      return NextResponse.json(
        { error: 'Not authorized to delete this file' },
        { status: 403 }
      );
    }

    await db.codeFile.delete({
      where: { id },
    });

    return NextResponse.json({ message: 'File deleted successfully' });
  } catch (error) {
    console.error('Delete file error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
