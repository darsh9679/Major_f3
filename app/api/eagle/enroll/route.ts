import { NextRequest, NextResponse } from "next/server";
import { db } from "@/firebase/admin";
// Dynamic import to avoid bundling issues with native modules
let EagleProfiler: any;
let EagleProfilerEnrollFeedback: any;

try {
  const eagleModule = require("@picovoice/eagle-node");
  EagleProfiler = eagleModule.EagleProfiler;
  EagleProfilerEnrollFeedback = eagleModule.EagleProfilerEnrollFeedback;
} catch (error) {
  console.error("Failed to load Eagle module:", error);
}

const PICOVOICE_ACCESS_KEY = process.env.PICOVOICE_ACCESS_KEY || "";

if (!PICOVOICE_ACCESS_KEY) {
  console.warn("PICOVOICE_ACCESS_KEY is not set. Voice recognition will not work.");
}

/**
 * Converts WebM audio blob to PCM16 audio data
 * This is a simplified version - in production, you'd want to use a proper audio decoder
 */
async function convertWebMToPCM16(audioBlob: Blob): Promise<Int16Array> {
  // In a real implementation, you'd use a library like 'web-audio-api' or 'ffmpeg'
  // For now, this is a placeholder that would need proper audio decoding
  // The actual implementation would:
  // 1. Decode WebM/Opus audio to raw PCM
  // 2. Resample to 16kHz if needed
  // 3. Convert to mono if stereo
  // 4. Convert float32 to int16

  // This is a placeholder - you'll need to implement proper audio conversion
  throw new Error("Audio conversion not implemented. Use a proper audio decoder library.");
}

export async function POST(request: NextRequest) {
  try {
    if (!PICOVOICE_ACCESS_KEY) {
      return NextResponse.json(
        { success: false, error: "Picovoice access key not configured" },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const audioFile = formData.get("audio") as File;
    const userId = formData.get("userId") as string;

    if (!audioFile || !userId) {
      return NextResponse.json(
        { success: false, error: "Missing audio file or userId" },
        { status: 400 }
      );
    }

    // Convert audio file to buffer
    const arrayBuffer = await audioFile.arrayBuffer();
    const audioBlob = new Blob([arrayBuffer], { type: audioFile.type });

    // Initialize Eagle Profiler
    if (!EagleProfiler) {
      return NextResponse.json(
        { success: false, error: "Eagle module not available. Please check server configuration." },
        { status: 500 }
      );
    }

    try {
      const profiler = new EagleProfiler(PICOVOICE_ACCESS_KEY);
      const minEnrollSamples = profiler.minEnrollSamples;
      const sampleRate = profiler.sampleRate;

      console.log("[ENROLL] Started enrollment with:", {
        userId,
        minEnrollSamples,
        sampleRate,
      });

      // Convert audio file to Int16Array (raw PCM)
      const arrayBuffer = await audioFile.arrayBuffer();
      const pcmData = new Int16Array(arrayBuffer);

      console.log("[ENROLL] Audio data:", {
        pcmLength: pcmData.length,
        durationSec: pcmData.length / sampleRate,
      });

      let percentage = 0;
      let feedback: any = null;
      let frameCount = 0;

      // Process ALL audio frames and keep track of enrollment progress
      for (let i = 0; i < pcmData.length && percentage < 100; i += minEnrollSamples) {
        const frame = pcmData.slice(i, i + minEnrollSamples);
        if (frame.length === minEnrollSamples) {
          const result = profiler.enroll(frame);
          percentage = result.percentage;
          feedback = result.feedback;
          frameCount++;
        }
      }

      console.log("[ENROLL] Enrollment progress:", {
        percentage,
        feedback,
        frameCount,
      });

      // Only export if we reached 100% enrollment
      if (percentage < 100) {
        profiler.release();
        return NextResponse.json({
          success: false,
          error: `Enrollment incomplete (${percentage}%). Need more audio. Please speak for a longer duration.`,
          percentage,
        });
      }

      // Export the speaker profile
      let speakerProfile;
      try {
        speakerProfile = profiler.export();
        console.log("[ENROLL] Raw export result type:", typeof speakerProfile);
        console.log("[ENROLL] Raw export result:", speakerProfile);
      } catch (exportError: any) {
        console.error("[ENROLL] Export error:", exportError);
        profiler.release();
        return NextResponse.json({
          success: false,
          error: `Failed to export profile: ${exportError.message}`,
        });
      }

      // Handle different possible return types
      let profileArray: number[];
      if (speakerProfile instanceof ArrayBuffer) {
        // Eagle returns ArrayBuffer - convert to Uint8Array then to Array
        profileArray = Array.from(new Uint8Array(speakerProfile));
      } else if (speakerProfile instanceof Uint8Array) {
        profileArray = Array.from(speakerProfile);
      } else if (Array.isArray(speakerProfile)) {
        profileArray = speakerProfile;
      } else if (speakerProfile && typeof speakerProfile === 'object' && speakerProfile.bytes) {
        // Some versions return an object with a bytes property
        profileArray = Array.from(speakerProfile.bytes);
      } else if (speakerProfile) {
        console.log("[ENROLL] Unknown profile format, converting:", Object.keys(speakerProfile));
        profileArray = Array.from(Object.values(speakerProfile));
      } else {
        console.error("[ENROLL] Profile export returned null/undefined");
        profiler.release();
        return NextResponse.json({
          success: false,
          error: "Profile export returned empty. Please try again.",
        });
      }

      console.log("[ENROLL] Profile exported:", {
        userId,
        profileLength: profileArray.length,
        percentage,
      });

      // Save actual profile to database
      await db.collection("voiceProfiles").doc(userId).set({
        profile: profileArray,
        createdAt: new Date().toISOString(),
        sampleRate: sampleRate || 16000,
        enrolled: true,
        placeholder: false,
      });

      console.log("[ENROLL] Profile saved to database with placeholder: false");

      profiler.release();

      return NextResponse.json({
        success: true,
        message: "Voice enrollment completed successfully",
        profileId: userId,
        percentage,
        profileLength: profileArray.length,
      });
    } catch (error: any) {
      console.error("Eagle profiler error:", error);
      return NextResponse.json({
        success: false,
        error: error.message || "Failed to process voice enrollment",
      });
    }
  } catch (error: any) {
    console.error("Enrollment error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to enroll voice",
      },
      { status: 500 }
    );
  }
}
