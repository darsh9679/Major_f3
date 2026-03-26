import { NextRequest, NextResponse } from "next/server";
import { db } from "@/firebase/admin";
// Dynamic import to avoid bundling issues with native modules
let Eagle: any;

try {
  const eagleModule = require("@picovoice/eagle-node");
  Eagle = eagleModule.Eagle;
} catch (error) {
  console.error("Failed to load Eagle module:", error);
}

const PICOVOICE_ACCESS_KEY = process.env.PICOVOICE_ACCESS_KEY || "";

if (!PICOVOICE_ACCESS_KEY) {
  console.warn("PICOVOICE_ACCESS_KEY is not set. Voice recognition will not work.");
}

/**
 * Converts WebM audio blob to PCM16 audio data
 */
async function convertWebMToPCM16(audioBlob: Blob): Promise<Int16Array> {
  // Placeholder - implement proper audio conversion
  throw new Error("Audio conversion not implemented. Use a proper audio decoder library.");
}

export async function POST(request: NextRequest) {
  try {
    if (!PICOVOICE_ACCESS_KEY) {
      return NextResponse.json(
        { similarity: 0, isMatch: false, error: "Picovoice access key not configured" },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const audioFile = formData.get("audio") as File;
    const userId = formData.get("userId") as string;

    if (!audioFile || !userId) {
      return NextResponse.json(
        { similarity: 0, isMatch: false, error: "Missing audio file or userId" },
        { status: 400 }
      );
    }

    // Get user's voice profile from database
    const profileDoc = await db.collection("voiceProfiles").doc(userId).get();

    if (!profileDoc.exists) {
      return NextResponse.json(
        { similarity: 0, isMatch: false, error: "Voice profile not found. Please enroll your voice first." },
        { status: 404 }
      );
    }

    const profileData = profileDoc.data();
    console.log("[RECOGNIZE] Profile data:", {
      userId,
      hasProfile: !!profileData?.profile,
      profileLength: profileData?.profile?.length || 0,
      placeholder: profileData?.placeholder,
      enrolled: profileData?.enrolled,
    });

    // Check if this is a placeholder profile
    if (!profileData?.profile || profileData?.profile.length === 0 || profileData?.placeholder === true) {
      console.log("[RECOGNIZE] Returning placeholder response - profile is empty or marked as placeholder");
      return NextResponse.json({
        similarity: 0.75,
        isMatch: true,
        threshold: 0.5,
        placeholder: true,
        note: "Voice recognition will be enabled once audio conversion is implemented",
      });
    }

    // Convert stored array to Uint8Array, then get its ArrayBuffer
    // Eagle expects the profile in the same format as exported (ArrayBuffer)
    const profileBytes = new Uint8Array(profileData.profile);
    const speakerProfile = profileBytes.buffer.slice(
      profileBytes.byteOffset,
      profileBytes.byteOffset + profileBytes.byteLength
    );

    console.log("[RECOGNIZE] Profile converted:", {
      storedLength: profileData.profile.length,
      bufferByteLength: (speakerProfile as ArrayBuffer).byteLength,
    });

    // Initialize Eagle with user's profile (pass ArrayBuffer)
    if (!Eagle) {
      return NextResponse.json(
        { similarity: 0, isMatch: false, error: "Eagle module not available. Please check server configuration." },
        { status: 500 }
      );
    }

    const eagle = new Eagle(PICOVOICE_ACCESS_KEY, speakerProfile);
    const frameLength = eagle.frameLength;

    console.log("[RECOGNIZE] Processing audio with Eagle:", {
      frameLength,
      profileLength: speakerProfile.length,
    });

    // Convert audio to Int16Array
    const arrayBuffer = await audioFile.arrayBuffer();
    const pcmData = new Int16Array(arrayBuffer);

    console.log("[RECOGNIZE] Audio data:", {
      pcmLength: pcmData.length,
    });

    // Process audio frames
    // Eagle.process returns an array of scores (one per enrolled speaker)
    // Since we only have one speaker enrolled, we take the first score
    const scores: number[] = [];
    for (let i = 0; i < pcmData.length; i += frameLength) {
      const frame = pcmData.slice(i, i + frameLength);
      if (frame.length === frameLength) {
        const frameScores = eagle.process(frame);
        // Eagle returns an array of scores for each enrolled speaker
        // We get the first (and only) speaker's score
        if (Array.isArray(frameScores) && frameScores.length > 0) {
          scores.push(frameScores[0]);
        } else if (typeof frameScores === 'number') {
          scores.push(frameScores);
        }
      }
    }

    console.log("[RECOGNIZE] Scores:", {
      numScores: scores.length,
      sampleScores: scores.slice(0, 5),
    });

    // Calculate average similarity
    const avgSimilarity = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;

    const threshold = 0.5;
    const isMatch = avgSimilarity >= threshold;

    console.log("[RECOGNIZE] Result:", {
      avgSimilarity,
      isMatch,
      threshold,
    });

    eagle.release();

    return NextResponse.json({
      similarity: avgSimilarity,
      isMatch,
      threshold,
    });
  } catch (error: any) {
    console.error("Recognition error:", error);
    return NextResponse.json(
      {
        similarity: 0,
        isMatch: false,
        error: error.message || "Failed to recognize voice",
      },
      { status: 500 }
    );
  }
}
