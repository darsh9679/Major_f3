"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { captureAudioForEnrollment, audioBlobToBase64, EnrollmentProgress } from "@/lib/eagle/enrollment";
import { Button } from "@/components/ui/button";
import { convertBlobToPCM16 } from "@/lib/audio-utils";

interface VoiceEnrollmentProps {
  userId: string;
  returnUrl?: string;
  onComplete?: (success: boolean) => void;
}

export default function VoiceEnrollment({ userId, returnUrl = "/", onComplete }: VoiceEnrollmentProps) {
  const router = useRouter();
  const [isRecording, setIsRecording] = useState(false);
  const [progress, setProgress] = useState<EnrollmentProgress>({ percentage: 0, feedback: "" });
  const [error, setError] = useState<string | null>(null);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  const handleEnroll = async () => {
    try {
      setError(null);
      setIsRecording(true);
      setProgress({ percentage: 0, feedback: "Starting recording..." });

      // Capture 30 seconds of audio
      const audioBlob = await captureAudioForEnrollment(30000, (progress) => {
        setProgress(progress);
      });

      setIsRecording(false);
      setIsEnrolling(true);
      setProgress({ percentage: 0, feedback: "Processing your voice..." });

      // Convert WebM to PCM16 before sending to server
      const pcmData = await convertBlobToPCM16(audioBlob);

      const formData = new FormData();
      // Send raw PCM data as binary blob
      const pcmBlob = new Blob([pcmData.buffer as ArrayBuffer], { type: "application/octet-stream" });
      formData.append("audio", pcmBlob, "enrollment.raw");
      formData.append("userId", userId);

      const response = await fetch("/api/eagle/enroll", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        setProgress({ percentage: 100, feedback: "Voice enrollment completed successfully!" });
        setIsComplete(true);
        if (onComplete) {
          onComplete(true);
        } else {
          // Auto-redirect to return URL after 2 seconds if no onComplete callback
          setTimeout(() => {
            router.push(returnUrl);
          }, 2000);
        }
      } else {
        throw new Error(result.error || "Enrollment failed");
      }
    } catch (err: any) {
      console.error("Enrollment error:", err);
      setError(err.message || "Failed to enroll voice. Please try again.");
      setProgress({ percentage: 0, feedback: "" });
      if (onComplete) {
        onComplete(false);
      }
    } finally {
      setIsRecording(false);
      setIsEnrolling(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 p-6 border rounded-lg bg-white dark:bg-gray-800 shadow-sm max-w-md mx-auto">
      <h3 className="text-lg font-semibold">Voice Enrollment</h3>
      <p className="text-sm text-gray-600 dark:text-gray-300 text-center">
        Please record your voice for 30 seconds. Speak naturally and clearly.
        This will help us verify your identity during interviews.
      </p>

      {error && (
        <div className="w-full p-3 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-800 text-red-700 dark:text-red-300 rounded">
          {error}
        </div>
      )}

      {progress.percentage > 0 && (
        <div className="w-full">
          <div className="flex justify-between text-sm mb-2 text-gray-700 dark:text-gray-300">
            <span>{progress.feedback}</span>
            <span>{progress.percentage}%</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-100"
              style={{ width: `${progress.percentage}%` }}
            />
          </div>
        </div>
      )}

      {!isComplete && (
        <Button
          onClick={handleEnroll}
          disabled={isRecording || isEnrolling}
          className="w-full"
        >
          {isRecording
            ? "Recording..."
            : isEnrolling
              ? "Processing..."
              : "Start Voice Enrollment"}
        </Button>
      )}

      {isComplete && (
        <div className="w-full">
          <Button
            onClick={() => router.push(returnUrl)}
            className="w-full bg-green-600 hover:bg-green-700 text-white"
          >
            {returnUrl !== "/" ? "Continue to Interview" : "Continue to Interviews"}
          </Button>
        </div>
      )}

      {isRecording && (
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
          <span>Recording in progress...</span>
        </div>
      )}
    </div>
  );
}
