
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import fs from "fs";
import path from "path";

// Manually load environment variables from .env.local
try {
    const envPath = path.resolve(process.cwd(), ".env.local");
    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, 'utf8');
        envConfig.split('\n').forEach(line => {
            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) {
                let value = match[2].trim();
                // Remove quotes if present
                if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }
                process.env[match[1].trim()] = value;
            }
        });
    } else {
        console.error(".env.local file not found at:", envPath);
    }
} catch (e) {
    console.error("Error loading .env.local:", e);
}

async function testGemini() {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    console.log("Testing Gemini API...");
    console.log("API Key present:", !!apiKey);
    console.log("API Key prefix:", apiKey ? apiKey.substring(0, 10) + "..." : "N/A");

    try {
        console.log("Attempting to generate text with model: gemini-2.0-flash-001");
        // Use the exact same model call as the app
        const { text } = await generateText({
            model: google("gemini-2.0-flash-001"),
            prompt: "Hello, reply with 'OK' if you receive this.",
        });
        console.log("SUCCESS: Generated text:", text);
    } catch (error: any) {
        console.error("ERROR: Failed to generate text.");
        console.error("Error message:", error.message);
        if (error.status) console.error("Status code:", error.status);
        if (error.cause) console.error("Cause:", error.cause);

        // Log helpful info for quota errors
        if (error.message && error.message.includes("429")) {
            console.error(">>> THIS IS A QUOTA ERROR (429). The API key is valid but quota is exceeded or rate limited. <<<");
        }
        if (error.message && error.message.includes("400")) {
            console.error(">>> THIS IS A BAD REQUEST (400). Could be invalid key, project not enabled, or region block. <<<");
        }
    }
}

testGemini();
