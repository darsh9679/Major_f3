"use client";

import Image from "next/image";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { vapi } from "@/lib/vapi.sdk";
import { interviewer } from "@/constants";
import { createFeedback } from "@/lib/actions/general.action";
import { VoiceMonitor } from "@/lib/eagle/recognition";

enum CallStatus {
  INACTIVE = "INACTIVE",
  CONNECTING = "CONNECTING",
  ACTIVE = "ACTIVE",
  FINISHED = "FINISHED",
}

interface SavedMessage {
  role: "user" | "system" | "assistant";
  content: string;
}

/** Minimal Message shape expected from vapi events — adjust to match your SDK */
type VapiMessage = {
  type?: string;
  transcriptType?: string;
  transcript?: string;
  role?: "user" | "assistant" | "system";
  // other fields...
};

type AgentProps = {
  userName?: string;
  userId?: string;
  interviewId?: string;
  feedbackId?: string;
  type?: "generate" | "feedback" | "interview";
  questions?: string[];
};

const Agent = ({
  userName,
  userId,
  interviewId,
  feedbackId,
  type,
  questions,
}: AgentProps) => {
  const router = useRouter();
  const [callStatus, setCallStatus] = useState<CallStatus>(CallStatus.INACTIVE);
  const [messages, setMessages] = useState<SavedMessage[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastMessage, setLastMessage] = useState<string>("");
  const [voiceWarning, setVoiceWarning] = useState<string | null>(null);
  const voiceMonitorRef = useRef<VoiceMonitor | null>(null);

  // build-time env var (NEXT_PUBLIC_ is safe to access in client builds)
  const WORKFLOW_ID = process.env.NEXT_PUBLIC_VAPI_WORKFLOW_ID ?? "";

  useEffect(() => {
    const onCallStart = async () => {
      setCallStatus(CallStatus.ACTIVE);

      // Start voice monitoring if userId is available
      if (userId && (type === "interview" || type === "feedback")) {
        try {
          // Check if user has voice profile
          const profileCheck = await fetch(`/api/eagle/check-profile?userId=${userId}`);
          const hasProfile = profileCheck.ok && (await profileCheck.json()).hasProfile;

          const monitor = new VoiceMonitor(
            userId,
            {
              threshold: 0.5,
              checkInterval: 3000, // Check every 3 seconds
              warningThreshold: 0.3,
              warningCooldown: 10000, // 10 seconds cooldown between warnings
            },
            (similarity) => {
              const similarityPercent = Math.round(similarity * 100);
              setVoiceWarning(
                `⚠️ Voice mismatch detected! (${similarityPercent}% match). Please ensure only the enrolled candidate is speaking.`
              );

              // Clear warning after 6 seconds (slightly longer to be readable)
              setTimeout(() => {
                setVoiceWarning(null);
              }, 6000);
            }
          );

          monitor.setHasProfile(hasProfile);
          monitor.start();
          voiceMonitorRef.current = monitor;
        } catch (error) {
          console.error("Failed to start voice monitoring:", error);
          // Don't block the call if voice monitoring fails
        }
      }
    };

    const onCallEnd = () => {
      setCallStatus(CallStatus.FINISHED);

      // Stop voice monitoring
      if (voiceMonitorRef.current) {
        voiceMonitorRef.current.stop();
        voiceMonitorRef.current = null;
      }
      setVoiceWarning(null);
    };

    const onMessage = (message: VapiMessage) => {
      // Only persist unique final transcripts; ignore duplicate finals that some providers resend
      if (
        message?.type === "transcript" &&
        message?.transcriptType === "final" &&
        typeof message?.transcript === "string" &&
        message.transcript.trim().length > 0
      ) {
        const trimmed = message.transcript.trim();
        const role = (message.role as SavedMessage["role"]) ?? "assistant";

        setMessages((prev) => {
          // Check for duplicates - compare both content and role to avoid false positives
          const last = prev[prev.length - 1];
          if (last && last.content.trim() === trimmed && last.role === role) {
            return prev;
          }
          return [
            ...prev,
            { role, content: trimmed },
          ];
        });
      }
    };

    const onSpeechStart = () => {
      console.log("speech start");
      setIsSpeaking(true);
      // Mark AI as speaking so we don't check voice during AI speech
      if (voiceMonitorRef.current) {
        voiceMonitorRef.current.setAISpeaking(true);
      }
    };

    const onSpeechEnd = () => {
      console.log("speech end");
      setIsSpeaking(false);
      // Mark AI as not speaking so we can check user voice
      if (voiceMonitorRef.current) {
        voiceMonitorRef.current.setAISpeaking(false);
      }
    };

    const onError = async (error: any) => {
      console.error("Vapi error event:", error);
      // Log error information without reading Response body to avoid "body already read" errors
      try {
        if (error && error instanceof Response) {
          // Log status and statusText without reading body
          console.error("Vapi error - Status:", error.status, "StatusText:", error.statusText, "URL:", error.url);
        } else if (error && error.error && error.error instanceof Response) {
          // Log nested Response without reading body
          console.error("Vapi error (nested) - Status:", error.error.status, "StatusText:", error.error.statusText, "URL:", error.error.url);
        } else {
          // Log error message or string representation
          console.error("Vapi error details:", error?.message || error?.toString() || error);
        }
      } catch (ex: any) {
        console.error("Error processing Vapi error:", ex);
      }
      // ensure UI updates
      setCallStatus(CallStatus.INACTIVE);
    };

    vapi.on("call-start", onCallStart);
    vapi.on("call-end", onCallEnd);
    vapi.on("message", onMessage);
    vapi.on("speech-start", onSpeechStart);
    vapi.on("speech-end", onSpeechEnd);
    vapi.on("error", onError);

    return () => {
      vapi.off("call-start", onCallStart);
      vapi.off("call-end", onCallEnd);
      vapi.off("message", onMessage);
      vapi.off("speech-start", onSpeechStart);
      vapi.off("speech-end", onSpeechEnd);
      vapi.off("error", onError);

      // Cleanup voice monitor
      if (voiceMonitorRef.current) {
        voiceMonitorRef.current.stop();
        voiceMonitorRef.current = null;
      }
    };
  }, [userId, type]);

  useEffect(() => {
    const handleGenerateFeedback = async (messages: SavedMessage[]) => {
      // Validate we have messages before generating feedback
      if (!messages || messages.length === 0) {
        console.error("No messages to generate feedback from");
        router.push("/");
        return;
      }

      // Validate required props
      if (!interviewId || !userId) {
        console.error("Missing required props for feedback generation");
        router.push("/");
        return;
      }

      try {
        console.log("Calling createFeedback with:", {
          interviewId,
          userId,
          messagesCount: messages.length,
          feedbackId,
        });

        const result = await createFeedback({
          interviewId: interviewId,
          userId: userId,
          transcript: messages,
          feedbackId,
        });

        console.log("createFeedback result:", result);

        if (result.success && result.feedbackId) {
          router.push(`/interview/${interviewId}/feedback`);
        } else {
          console.error("Error saving feedback - success:", result.success, "feedbackId:", result.feedbackId, "error:", result.error);
          // Show user-friendly error message
          alert(`Failed to generate feedback: ${result.error || "Unknown error"}. Please try again.`);
          router.push("/");
        }
      } catch (err: any) {
        console.error("createFeedback error:", err);
        console.error("Error stack:", err?.stack);
        alert(`An error occurred while generating feedback: ${err?.message || "Unknown error"}. Please try again.`);
        router.push("/");
      }
    };

    if (callStatus === CallStatus.FINISHED) {
      if (type === "generate") {
        router.push("/");
      } else if (type === "interview" || type === "feedback") {
        handleGenerateFeedback(messages);
      }
    }
  }, [messages, callStatus, feedbackId, interviewId, router, type, userId]);

  // Check for voice profile on mount for interview mode
  useEffect(() => {
    const checkProfile = async () => {
      if ((type === "interview" || type === "feedback") && userId) {
        try {
          const profileCheck = await fetch(`/api/eagle/check-profile?userId=${userId}`);
          const profileData = await profileCheck.json();

          if (!profileData.hasProfile) {
            console.log("No voice profile found, redirecting to enrollment");
            // Pass the current interview page as return URL
            const returnUrl = type === "interview" && interviewId
              ? `/interview/${interviewId}`
              : "/";
            router.push(`/voice-enroll?returnUrl=${encodeURIComponent(returnUrl)}`);
          }
        } catch (error) {
          console.error("Error checking voice profile on mount:", error);
        }
      }
    };

    checkProfile();
  }, [type, userId, interviewId, router]);

  const handleCall = async () => {
    // validate workflow id(s) before starting
    setCallStatus(CallStatus.CONNECTING);

    // Validate required props for interview/feedback mode
    if ((type === "interview" || type === "feedback") && (!interviewId || !userId)) {
      console.error("Missing required props: interviewId and userId are required for interview/feedback mode");
      setCallStatus(CallStatus.INACTIVE);
      return;
    }

    // Check if user has voice profile for interviews
    if ((type === "interview" || type === "feedback") && userId) {
      try {
        const profileCheck = await fetch(`/api/eagle/check-profile?userId=${userId}`);
        const profileData = await profileCheck.json();

        if (!profileData.hasProfile) {
          const shouldEnroll = confirm(
            "Voice enrollment is required for interviews. Would you like to enroll your voice now?"
          );

          if (shouldEnroll) {
            // Pass the current interview page as return URL
            const returnUrl = type === "interview" && interviewId
              ? `/interview/${interviewId}`
              : "/";
            router.push(`/voice-enroll?returnUrl=${encodeURIComponent(returnUrl)}`);
            setCallStatus(CallStatus.INACTIVE);
            return;
          } else {
            // User chose not to enroll, but allow them to proceed
            console.warn("User proceeding without voice enrollment");
          }
        }
      } catch (error) {
        console.error("Error checking voice profile:", error);
        // Continue anyway - don't block the call
      }
    }

    try {
      if (type === "generate") {
        // Use workflow ID for generation
        if (!WORKFLOW_ID) {
          console.error("No workflow id provided. Check NEXT_PUBLIC_VAPI_WORKFLOW_ID.");
          setCallStatus(CallStatus.INACTIVE);
          return;
        }
        await vapi.start(WORKFLOW_ID, {
          variableValues: {
            username: userName ?? "",
            userid: userId ?? "",
          },
        });
      } else if (type === "interview" || type === "feedback") {
        // Use assistant object for interviews
        const formattedQuestions = (questions || []).map((q) => `- ${q}`).join("\n");

        if (!interviewer.model || !Array.isArray((interviewer.model as any).messages)) {
          console.error("Invalid interviewer configuration");
          return;
        }

        // Create a copy of the interviewer assistant with questions replaced
        const assistantWithQuestions = {
          ...interviewer,
          model: {
            ...interviewer.model,
            messages: (interviewer.model as any).messages.map((msg: any) => ({
              ...msg,
              content: msg.content ? msg.content.replace("{{questions}}", formattedQuestions) : "",
            })),
          },
        };

        await vapi.start(assistantWithQuestions as any);
      }
      // if start resolves, callStatus will be set via onCallStart event
    } catch (e: any) {
      console.error("vapi.start threw:", e);
      // Log error information without reading Response body to avoid "body already read" errors
      try {
        if (e && e instanceof Response) {
          // Log status and statusText without reading body
          console.error("Server error - Status:", e.status, "StatusText:", e.statusText, "URL:", e.url);
        } else if (e && e.error && e.error instanceof Response) {
          // Log nested Response without reading body
          console.error("Server error (nested) - Status:", e.error.status, "StatusText:", e.error.statusText, "URL:", e.error.url);
        } else {
          // Log error message or string representation
          console.error("Error details:", e?.message || e?.toString() || e);
        }
      } catch (ex: any) {
        console.error("Error processing thrown error:", ex);
      }
      setCallStatus(CallStatus.INACTIVE);
    }
  };

  const handleDisconnect = () => {
    setCallStatus(CallStatus.FINISHED);
    try {
      vapi.stop();
    } catch (err) {
      console.error("Error stopping vapi:", err);
      setCallStatus(CallStatus.INACTIVE);
    }
  };

  return (
    <>
      <div className="call-view">
        {/* AI Interviewer Card */}
        <div className="card-interviewer">
          <div className="avatar">
            <Image
              src="/ai-avatar.png"
              alt="profile-image"
              width={65}
              height={54}
              className="object-cover"
            />
            {isSpeaking && <span className="animate-speak" />}
          </div>
          <h3>AI Interviewer</h3>
        </div>

        {/* User Profile Card */}
        <div className="card-border">
          <div className="card-content">
            <Image
              src="/user-avatar.png"
              alt="profile-image"
              width={120}
              height={120}
              className="rounded-full object-cover w-[120px] h-[120px]"
            />
            <h3>{userName}</h3>
          </div>
        </div>
      </div>

      {voiceWarning && (
        <div className="fixed top-24 left-1/2 transform -translate-x-1/2 z-50 animate-bounce">
          <div className="bg-red-600 text-white px-6 py-4 rounded-lg shadow-xl border-2 border-red-800 flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="font-bold text-lg">Unknown Speaker Detected</p>
              <p className="text-sm text-red-100">{voiceWarning.replace("⚠️ ", "")}</p>
            </div>
          </div>
        </div>
      )}

      {messages.length > 0 && (
        <div className="transcript-border">
          <div className="transcript">
            {(() => {
              const last = messages[messages.length - 1];
              return (
                <p key={`${last.content}-${messages.length - 1}`} className={cn("transition-opacity duration-500", "animate-fadeIn")}>
                  {last.content}
                </p>
              );
            })()}
          </div>
        </div>
      )}

      <div className="w-full flex justify-center">
        {callStatus !== CallStatus.ACTIVE ? (
          <button className="relative btn-call" onClick={() => handleCall()}>
            <span
              className={cn(
                "absolute animate-ping rounded-full opacity-75",
                callStatus !== CallStatus.CONNECTING && "hidden"
              )}
            />
            <span className="relative">
              {callStatus === CallStatus.INACTIVE || callStatus === CallStatus.FINISHED ? "Call" : ". . ."}
            </span>
          </button>
        ) : (
          <button className="btn-disconnect" onClick={() => handleDisconnect()}>
            End
          </button>
        )}
      </div>
    </>
  );
};

export default Agent;
