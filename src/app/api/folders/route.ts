import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';

// GET /api/folders — List all folders for the authenticated user
export async function GET(request: NextRequest) {
  try {
    const authUser = getUserFromRequest(request);
    if (!authUser) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const folders = await db.folder.findMany({
      where: { userId: authUser.userId },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({ folders });
  } catch (error) {
    console.error('Get folders error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/folders — Create a new folder
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
    const { name, parentId } = body;

    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: 'Folder name is required' },
        { status: 400 }
      );
    }

    // Validate parentId if provided
    if (parentId) {
      const parentFolder = await db.folder.findFirst({
        where: { id: parentId, userId: authUser.userId },
      });
      if (!parentFolder) {
        return NextResponse.json(
          { error: 'Parent folder not found' },
          { status: 404 }
        );
      }
    }

    const folder = await db.folder.create({
      data: {
        name: name.trim(),
        parentId: parentId || null,
        userId: authUser.userId,
      },
    });

    return NextResponse.json({ folder }, { status: 201 });
  } catch (error) {
    console.error('Create folder error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT /api/folders — Update a folder (rename or move)
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
    const { id, name, parentId } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Folder ID is required' },
        { status: 400 }
      );
    }

    const folder = await db.folder.findFirst({
      where: { id, userId: authUser.userId },
    });

    if (!folder) {
      return NextResponse.json(
        { error: 'Folder not found' },
        { status: 404 }
      );
    }

    // Prevent circular references
    if (parentId && parentId !== folder.parentId) {
      if (parentId === id) {
        return NextResponse.json(
          { error: 'Cannot move folder into itself' },
          { status: 400 }
        );
      }
      // Check if the new parent is a descendant of this folder
      let currentParentId: string | null = parentId;
      while (currentParentId) {
        if (currentParentId === id) {
          return NextResponse.json(
            { error: 'Cannot create circular folder references' },
            { status: 400 }
          );
        }
        const parent = await db.folder.findUnique({ where: { id: currentParentId } });
        currentParentId = parent?.parentId || null;
      }
    }

    const updateData: { name?: string; parentId?: string | null } = {};
    if (name !== undefined) updateData.name = name.trim();
    if (parentId !== undefined) updateData.parentId = parentId || null;

    const updated = await db.folder.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ folder: updated });
  } catch (error) {
    console.error('Update folder error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/folders — Delete a folder and all its contents
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
        { error: 'Folder ID is required' },
        { status: 400 }
      );
    }

    const folder = await db.folder.findFirst({
      where: { id, userId: authUser.userId },
    });

    if (!folder) {
      return NextResponse.json(
        { error: 'Folder not found' },
        { status: 404 }
      );
    }

    // Cascade delete will handle child folders and files
    await db.folder.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete folder error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
