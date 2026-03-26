import { generateText } from "ai";
import { groq } from "@ai-sdk/groq";

import { db } from "@/firebase/admin";
import { getRandomInterviewCover } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    // Parse and validate request body
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      return Response.json(
        { success: false, error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    console.log("[GENERATE] Raw body received:", JSON.stringify(body, null, 2));

    // Handle Vapi's webhook payload format
    // Vapi sends: { message: { type: "tool-calls", toolCallList: [{ function: { name, arguments } }] } }
    let params: Record<string, any> = {};

    if (body?.message?.toolCallList?.length > 0) {
      // Vapi tool-call format
      const toolCall = body.message.toolCallList[0];
      params = toolCall?.function?.arguments || {};
      console.log("[GENERATE] Detected Vapi tool-call format, params:", params);
    } else if (body?.message?.functionCall?.parameters) {
      // Vapi older function-call format
      params = body.message.functionCall.parameters;
      console.log("[GENERATE] Detected Vapi function-call format, params:", params);
    } else {
      // Direct flat JSON call (e.g. from the app directly or testing)
      params = body;
      console.log("[GENERATE] Detected direct call format, params:", params);
    }

    const { type, role, level, techstack, amount, userid } = params;

    // Validate required fields
    if (!type || !role || !level || !techstack || !amount || !userid) {
      console.error("[GENERATE] Missing required fields:", { type, role, level, techstack, amount, userid });
      return Response.json(
        {
          success: false,
          error: "Missing required fields: type, role, level, techstack, amount, and userid are required",
        },
        { status: 400 }
      );
    }

    const { text: questions } = await generateText({
      model: groq("llama-3.3-70b-versatile"),
      prompt: `Prepare questions for a job interview.
        The job role is ${role}.
        The job experience level is ${level}.
        The tech stack used in the job is: ${techstack}.
        The focus between behavioural and technical questions should lean towards: ${type}.
        The amount of questions required is: ${amount}.
        Please return only the questions, without any additional text.
        The questions are going to be read by a voice assistant so do not use "/" or "*" or any other special characters which might break the voice assistant.
        Return the questions formatted like this:
        ["Question 1", "Question 2", "Question 3"]
        
        Thank you! <3
    `,
    });

    if (!questions || questions.trim().length === 0) {
      console.error("Generated questions are empty");
      return Response.json(
        {
          success: false,
          error: "Failed to generate questions. Please try again.",
        },
        { status: 500 }
      );
    }

    // Parse questions JSON with error handling
    let parsedQuestions;
    try {
      // Clean the questions string - remove markdown code blocks if present
      let cleanedQuestions = questions.trim();
      if (cleanedQuestions.startsWith("```json")) {
        cleanedQuestions = cleanedQuestions.replace(/^```json\s*/i, "").replace(/```\s*$/, "");
      } else if (cleanedQuestions.startsWith("```")) {
        cleanedQuestions = cleanedQuestions.replace(/^```\s*/, "").replace(/```\s*$/, "");
      }
      parsedQuestions = JSON.parse(cleanedQuestions);

      // Validate parsed questions is an array
      if (!Array.isArray(parsedQuestions) || parsedQuestions.length === 0) {
        console.error("Parsed questions is not a valid array:", parsedQuestions);
        return Response.json(
          {
            success: false,
            error: "Generated questions are not in the correct format. Please try again.",
          },
          { status: 500 }
        );
      }
    } catch (parseError) {
      console.error("Failed to parse questions JSON:", questions);
      console.error("Parse error:", parseError);
      return Response.json(
        {
          success: false,
          error: "Failed to parse generated questions. Please try again.",
        },
        { status: 500 }
      );
    }

    const interview = {
      role: role,
      type: type,
      level: level,
      techstack: techstack.split(","),
      questions: parsedQuestions,
      userId: userid,
      finalized: true,
      coverImage: getRandomInterviewCover(),
      createdAt: new Date().toISOString(),
    };

    await db.collection("interviews").add(interview);

    console.log("[GENERATE] Interview created successfully for userId:", userid);

    // Return success in Vapi-compatible format (for tool-call responses)
    return Response.json({ 
      results: [{ toolCallId: body?.message?.toolCallList?.[0]?.id || "direct", result: "Interview generated successfully" }],
      success: true 
    }, { status: 200 });
  } catch (error) {
    console.error("Error:", error);
    return Response.json({ success: false, error: error }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ success: true, data: "Thank you!" }, { status: 200 });
}
