"use client";

/**
 * Eagle Voice Enrollment Utility
 * Handles voice enrollment for speaker recognition
 */

export interface EnrollmentProgress {
  percentage: number;
  feedback: string;
}

export interface EnrollmentResult {
  success: boolean;
  profile?: Uint8Array;
  error?: string;
}

/**
 * Captures audio from user's microphone for enrollment
 */
export async function captureAudioForEnrollment(
  durationMs: number = 30000, // 30 seconds default
  onProgress?: (progress: EnrollmentProgress) => void
): Promise<Blob> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000, // Eagle requires 16kHz
        channelCount: 1, // Mono
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
    });

    const chunks: Blob[] = [];
    const startTime = Date.now();

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    return new Promise((resolve, reject) => {
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: "audio/webm" });
        resolve(blob);
      };

      mediaRecorder.onerror = (error) => {
        stream.getTracks().forEach((track) => track.stop());
        reject(error);
      };

      // Report progress
      const progressInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const percentage = Math.min((elapsed / durationMs) * 100, 100);

        if (onProgress) {
          onProgress({
            percentage: Math.round(percentage),
            feedback: percentage < 100 ? "Recording..." : "Recording complete",
          });
        }

        if (percentage >= 100) {
          clearInterval(progressInterval);
        }
      }, 100);

      mediaRecorder.start();

      setTimeout(() => {
        clearInterval(progressInterval);
        mediaRecorder.stop();
      }, durationMs);
    });
  } catch (error: any) {
    throw new Error(`Failed to capture audio: ${error.message}`);
  }
}

import { convertBlobToPCM16 } from "../audio-utils";

/**
 * Converts audio blob to base64 for transmission
 */
export async function audioBlobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      resolve(base64.split(",")[1]); // Remove data URL prefix
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Converts audio blob to PCM16 binary for transmission
 */
export async function audioBlobToPCM16(blob: Blob): Promise<Int16Array> {
  return await convertBlobToPCM16(blob);
}

