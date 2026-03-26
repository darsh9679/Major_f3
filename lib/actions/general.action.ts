"use server";

import { generateObject, generateText } from "ai";
import { groq } from "@ai-sdk/groq";

import { db } from "@/firebase/admin";
import { feedbackSchema } from "@/constants";

export async function createFeedback(params: CreateFeedbackParams) {
  const { interviewId, userId, transcript, feedbackId } = params;

  try {
    // Validate required parameters
    if (!interviewId || !userId) {
      console.error("Missing required parameters: interviewId and userId are required");
      return { success: false };
    }

    // Validate transcript is not empty
    if (!transcript || transcript.length === 0) {
      console.error("Transcript is empty. Cannot generate feedback without interview transcript.");
      return { success: false };
    }

    const formattedTranscript = transcript
      .map(
        (sentence: { role: string; content: string }) =>
          `- ${sentence.role}: ${sentence.content}\n`
      )
      .join("");

    let object;
    try {
      console.log("Starting feedback generation for interview:", interviewId);
      console.log("Transcript length:", transcript.length, "messages");

      // Try generateObject first with structured outputs
      try {
        const result = await generateObject({
          model: groq("llama-3.3-70b-versatile"),
          schema: feedbackSchema,
          prompt: `
          You are an AI interviewer analyzing a mock interview. Your task is to evaluate the candidate based on structured categories. Be thorough and detailed in your analysis. Don't be lenient with the candidate. If there are mistakes or areas for improvement, point them out.
          Transcript:
          ${formattedTranscript}

          Please score the candidate from 0 to 100 in the following categories. Use EXACTLY these category names (case-sensitive):
          - Communication Skills: Clarity, articulation, structured responses.
          - Technical Knowledge: Understanding of key concepts for the role.
          - Problem Solving: Ability to analyze problems and propose solutions.
          - Cultural Fit: Alignment with company values and job role.
          - Confidence and Clarity: Confidence in responses, engagement, and clarity.

          Return a JSON object with:
          - totalScore: A number from 0 to 100 representing the overall score
          - categoryScores: An array of exactly 5 objects, each with name (exact match above), score (0-100), and comment (string)
          - strengths: An array of strings describing the candidate's strengths
          - areasForImprovement: An array of strings describing areas for improvement
          - finalAssessment: A string with your overall assessment
          `,
        });

        object = result.object;
        console.log("Feedback object generated successfully with generateObject");
      } catch (generateObjectError: any) {
        console.warn("generateObject failed, trying generateText fallback:", generateObjectError?.message);

        // Fallback to generateText and manual parsing
        const { text } = await generateText({
          model: groq("llama-3.3-70b-versatile"),
          prompt: `
          You are an AI interviewer analyzing a mock interview. Your task is to evaluate the candidate based on structured categories. Be thorough and detailed in your analysis. Don't be lenient with the candidate. If there are mistakes or areas for improvement, point them out.
          Transcript:
          ${formattedTranscript}

          Please score the candidate from 0 to 100 in the following categories. Use EXACTLY these category names (case-sensitive):
          - Communication Skills: Clarity, articulation, structured responses.
          - Technical Knowledge: Understanding of key concepts for the role.
          - Problem Solving: Ability to analyze problems and propose solutions.
          - Cultural Fit: Alignment with company values and job role.
          - Confidence and Clarity: Confidence in responses, engagement, and clarity.

          Return ONLY valid JSON (no markdown, no code blocks) with this exact structure:
          {
            "totalScore": <number 0-100>,
            "categoryScores": [
              {"name": "Communication Skills", "score": <number>, "comment": "<string>"},
              {"name": "Technical Knowledge", "score": <number>, "comment": "<string>"},
              {"name": "Problem Solving", "score": <number>, "comment": "<string>"},
              {"name": "Cultural Fit", "score": <number>, "comment": "<string>"},
              {"name": "Confidence and Clarity", "score": <number>, "comment": "<string>"}
            ],
            "strengths": ["<string>", ...],
            "areasForImprovement": ["<string>", ...],
            "finalAssessment": "<string>"
          }
          `,
        });

        // Parse and validate the JSON response
        let cleanedText = text.trim();
        if (cleanedText.startsWith("```json")) {
          cleanedText = cleanedText.replace(/^```json\s*/i, "").replace(/```\s*$/, "");
        } else if (cleanedText.startsWith("```")) {
          cleanedText = cleanedText.replace(/^```\s*/, "").replace(/```\s*$/, "");
        }

        const parsed = JSON.parse(cleanedText);

        // Validate against schema
        const validationResult = feedbackSchema.safeParse(parsed);
        if (!validationResult.success) {
          console.error("Schema validation failed:", validationResult.error);
          throw new Error(`Schema validation failed: ${validationResult.error.message}`);
        }

        object = validationResult.data;
        console.log("Feedback object generated successfully with generateText fallback");
      }

      console.log("Feedback object generated successfully:", {
        totalScore: object?.totalScore,
        categoryScoresCount: object?.categoryScores?.length,
        hasStrengths: !!object?.strengths,
        hasAreasForImprovement: !!object?.areasForImprovement,
        hasFinalAssessment: !!object?.finalAssessment,
      });
    } catch (generateError: any) {
      console.error("Error generating feedback object:", generateError);
      // Log more details about the error
      if (generateError?.issues) {
        console.error("Schema validation issues:", JSON.stringify(generateError.issues, null, 2));
      }
      if (generateError?.message) {
        console.error("Error message:", generateError.message);
      }
      if (generateError?.cause) {
        console.error("Error cause:", generateError.cause);
      }
      if (generateError?.stack) {
        console.error("Error stack:", generateError.stack);
      }
      return { success: false, error: `Failed to generate feedback object: ${generateError?.message || "Unknown error"}` };
    }

    // Validate object structure
    if (!object) {
      console.error("Generated object is null or undefined");
      return { success: false, error: "Generated feedback object is invalid" };
    }

    if (object.totalScore === undefined || object.totalScore === null || typeof object.totalScore !== "number") {
      console.error("Invalid totalScore:", object.totalScore);
      return { success: false, error: "Invalid totalScore in generated feedback" };
    }

    if (!object.categoryScores || !Array.isArray(object.categoryScores) || object.categoryScores.length !== 5) {
      console.error("Invalid categoryScores:", object.categoryScores);
      return { success: false, error: "Invalid categoryScores in generated feedback" };
    }

    const feedback = {
      interviewId: interviewId,
      userId: userId,
      totalScore: object.totalScore,
      categoryScores: object.categoryScores,
      strengths: object.strengths || [],
      areasForImprovement: object.areasForImprovement || [],
      finalAssessment: object.finalAssessment || "",
      createdAt: new Date().toISOString(),
    };

    let feedbackRef;

    try {
      if (feedbackId) {
        feedbackRef = db.collection("feedback").doc(feedbackId);
      } else {
        feedbackRef = db.collection("feedback").doc();
      }

      console.log("Saving feedback to database, feedbackId:", feedbackRef.id);
      await feedbackRef.set(feedback);
      console.log("Feedback saved successfully");

      return { success: true, feedbackId: feedbackRef.id };
    } catch (dbError: any) {
      console.error("Error saving feedback to database:", dbError);
      console.error("Database error details:", {
        message: dbError?.message,
        code: dbError?.code,
        stack: dbError?.stack,
      });
      return { success: false, error: "Failed to save feedback to database" };
    }
  } catch (error: any) {
    console.error("Unexpected error in createFeedback:", error);
    console.error("Error details:", {
      message: error?.message,
      stack: error?.stack,
      name: error?.name,
    });
    return { success: false, error: error?.message || "Unexpected error occurred" };
  }
}

export async function getInterviewById(id: string): Promise<Interview | null> {
  const interview = await db.collection("interviews").doc(id).get();

  return interview.data() as Interview | null;
}

export async function getFeedbackByInterviewId(
  params: GetFeedbackByInterviewIdParams
): Promise<Feedback | null> {
  const { interviewId, userId } = params;

  const querySnapshot = await db
    .collection("feedback")
    .where("interviewId", "==", interviewId)
    .where("userId", "==", userId)
    .limit(1)
    .get();

  if (querySnapshot.empty) return null;

  const feedbackDoc = querySnapshot.docs[0];
  return { id: feedbackDoc.id, ...feedbackDoc.data() } as Feedback;
}

export async function getLatestInterviews(
  params: GetLatestInterviewsParams
): Promise<Interview[] | null> {
  const { userId, limit = 20 } = params;

  // Check if userId is valid before making the query
  if (!userId) {
    console.warn("getLatestInterviews: userId is undefined or empty");
    return [];
  }

  // First get all finalized interviews
  const interviews = await db
    .collection("interviews")
    .where("finalized", "==", true)
    .get();

  // Filter and sort in memory to avoid complex index requirements
  const filteredAndSorted = interviews.docs
    .map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }))
    .filter((interview) => interview.userId !== userId) // Exclude current user's interviews
    .sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return bTime - aTime; // Descending order
    })
    .slice(0, limit); // Apply limit after sorting

  return filteredAndSorted as Interview[];
}

export async function getInterviewsByUserId(
  userId: string
): Promise<Interview[] | null> {
  // Check if userId is valid before making the query
  if (!userId) {
    console.warn("getInterviewsByUserId: userId is undefined or empty");
    return [];
  }

  const interviews = await db
    .collection("interviews")
    .where("userId", "==", userId)
    .get();

  // Sort in memory to avoid index requirement
  const sortedInterviews = interviews.docs
    .map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }))
    .sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return bTime - aTime; // Descending order
    });

  return sortedInterviews as Interview[];
}
