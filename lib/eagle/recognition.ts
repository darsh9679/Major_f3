"use client";

/**
 * Eagle Voice Recognition Utility
 * Handles real-time voice recognition during interviews
 */

export interface RecognitionResult {
  similarity: number; // 0-1 score
  isMatch: boolean;
  timestamp: number;
  placeholder?: boolean; // True if this is a placeholder response (audio conversion not implemented)
}

export interface RecognitionConfig {
  threshold: number; // Minimum similarity score (0-1), default 0.5
  checkInterval: number; // How often to check (ms), default 1000
  warningThreshold: number; // When to show warning (0-1), default 0.3
}

const DEFAULT_CONFIG: RecognitionConfig = {
  threshold: 0.5,
  checkInterval: 1000,
  warningThreshold: 0.3,
};

/**
 * Captures audio chunk from microphone for recognition
 */
export async function captureAudioChunk(durationMs: number = 1000): Promise<Blob> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
    });

    const chunks: Blob[] = [];

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

      mediaRecorder.start();

      setTimeout(() => {
        mediaRecorder.stop();
      }, durationMs);
    });
  } catch (error: any) {
    throw new Error(`Failed to capture audio chunk: ${error.message}`);
  }
}

import { convertBlobToPCM16 } from "../audio-utils";

/**
 * Sends audio chunk to server for recognition
 */
export async function recognizeVoice(
  audioBlob: Blob,
  userId: string
): Promise<RecognitionResult> {
  try {
    // Convert WebM to PCM16 before sending to server
    const pcmData = await convertBlobToPCM16(audioBlob);

    const formData = new FormData();
    // Convert Int16Array to Blob (cast buffer to ArrayBuffer to fix lint)
    const pcmBlob = new Blob([pcmData.buffer as ArrayBuffer], { type: "application/octet-stream" });
    formData.append("audio", pcmBlob, "audio.raw");
    formData.append("userId", userId);

    const response = await fetch("/api/eagle/recognize", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Recognition failed: ${response.statusText}`);
    }

    const data = await response.json();

    // If profile not found, throw a specific error
    if (response.status === 404 || data.error?.includes("not found")) {
      const error = new Error("Voice profile not found");
      (error as any).isProfileNotFound = true;
      throw error;
    }

    return {
      similarity: data.similarity || 0,
      isMatch: data.isMatch || false,
      timestamp: Date.now(),
      placeholder: data.placeholder || false,
    };
  } catch (error: any) {
    // Re-throw profile not found errors
    if (error.isProfileNotFound) {
      throw error;
    }
    console.error("Voice recognition error:", error);
    return {
      similarity: 0,
      isMatch: false,
      timestamp: Date.now(),
    };
  }
}

/**
 * Monitors voice during interview call
 */
export class VoiceMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private isMonitoring: boolean = false;
  private config: RecognitionConfig & { warningCooldown?: number };
  private onWarning?: (similarity: number) => void;
  private userId: string;
  private isAISpeaking: boolean = false;
  private hasProfile: boolean = true; // Assume profile exists until proven otherwise
  private lastWarningTime: number = 0;

  constructor(
    userId: string,
    config: Partial<RecognitionConfig & { warningCooldown?: number }> = {},
    onWarning?: (similarity: number) => void
  ) {
    this.userId = userId;
    this.config = {
      ...DEFAULT_CONFIG,
      warningCooldown: 10000, // Default 10 seconds cooldown
      ...config
    };
    this.onWarning = onWarning;
  }

  setAISpeaking(speaking: boolean): void {
    this.isAISpeaking = speaking;
  }

  setHasProfile(hasProfile: boolean): void {
    this.hasProfile = hasProfile;
  }

  start(): void {
    if (this.isMonitoring) {
      return;
    }

    if (!this.hasProfile) {
      console.warn("Voice profile not found. Voice monitoring disabled.");
      return;
    }

    this.isMonitoring = true;
    this.intervalId = setInterval(async () => {
      // Only check voice when AI is NOT speaking (i.e., when user might be speaking)
      if (this.isAISpeaking) {
        return; // Skip checking when AI is speaking
      }

      try {
        const audioChunk = await captureAudioChunk(this.config.checkInterval);

        // Double check AI speaking state after capture (in case it started during capture)
        if (this.isAISpeaking) {
          return;
        }

        const result = await recognizeVoice(audioChunk, this.userId);

        // Skip warnings for placeholder profiles (audio conversion not implemented yet)
        if ((result as any).placeholder) {
          return; // Don't process placeholder responses
        }

        // Show warning if similarity is below threshold (including 0) - means unknown speaker
        // isMatch: false indicates the speaker doesn't match the enrolled profile
        const shouldWarn = !result.isMatch && result.similarity < this.config.warningThreshold;

        if (shouldWarn && this.onWarning) {
          const now = Date.now();
          const cooldown = this.config.warningCooldown || 10000;

          if (now - this.lastWarningTime > cooldown) {
            this.lastWarningTime = now;
            console.log("[VOICE_MONITOR] Triggering warning - similarity:", result.similarity, "isMatch:", result.isMatch);
            this.onWarning(result.similarity);
          }
        }
      } catch (error: any) {
        // If profile not found, disable monitoring
        if (error?.message?.includes("not found") || error?.message?.includes("404")) {
          console.warn("Voice profile not found. Disabling voice monitoring.");
          this.hasProfile = false;
          this.stop();
        } else if (error?.message?.includes("Bad Request") || error?.message?.includes("400")) {
          // Handle 400 errors gracefully - might be placeholder profile issue
          console.warn("Voice recognition temporarily unavailable (placeholder profile). Monitoring disabled.");
          this.hasProfile = false;
          this.stop();
        } else {
          console.error("Voice monitoring error:", error);
        }
      }
    }, this.config.checkInterval);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isMonitoring = false;
  }

  isActive(): boolean {
    return this.isMonitoring;
  }
}
