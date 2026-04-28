import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export async function POST() {
  try {
    // This runs on your local machine if you're running next dev
    console.log("Starting local git pull...");
    const { stdout, stderr } = await execPromise('git pull origin main --rebase');
    
    if (stderr && !stderr.includes('From https://github.com')) {
      console.error("Git Pull Error:", stderr);
      return NextResponse.json({ success: false, error: stderr }, { status: 500 });
    }

    console.log("Git Pull Successful:", stdout);
    return NextResponse.json({ success: true, output: stdout });
  } catch (error: any) {
    console.error("Local Sync Failed:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
