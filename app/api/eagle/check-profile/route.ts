import { NextRequest, NextResponse } from "next/server";
import { db } from "@/firebase/admin";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        { hasProfile: false, error: "Missing userId" },
        { status: 400 }
      );
    }

    // Check if user has voice profile
    const profileDoc = await db.collection("voiceProfiles").doc(userId).get();
    const profileData = profileDoc.data();
    
    // Consider it a valid profile if:
    // 1. Document exists AND
    // 2. Either has a non-empty profile array OR has enrolled flag set
    // (The enrolled flag allows placeholder profiles to be considered valid)
    const hasProfile = profileDoc.exists && (
      (profileData?.profile && profileData.profile.length > 0) || 
      profileData?.enrolled === true
    );
    
    return NextResponse.json({
      hasProfile,
      isPlaceholder: profileData?.placeholder === true,
    });
  } catch (error: any) {
    console.error("Error checking voice profile:", error);
    return NextResponse.json(
      { hasProfile: false, error: error.message },
      { status: 500 }
    );
  }
}
