
import { generateText } from "ai";
import { groq } from "@ai-sdk/groq";
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

async function testGroq() {
    const apiKey = process.env.GROQ_API_KEY;
    console.log("Testing Groq API...");
    console.log("API Key present:", !!apiKey);
    console.log("API Key prefix:", apiKey ? apiKey.substring(0, 8) + "..." : "N/A");

    try {
        console.log("Attempting to generate text with model: llama-3.3-70b-versatile");
        const { text } = await generateText({
            model: groq("llama-3.3-70b-versatile"),
            prompt: "Hello, confirm you are Groq and you are working.",
        });
        console.log("SUCCESS: Generated text:", text);
    } catch (error: any) {
        console.error("ERROR: Failed to generate text.");
        console.error("Error message:", error.message);
        if (error.status) console.error("Status code:", error.status);
        if (error.cause) console.error("Cause:", error.cause);
    }
}

testGroq();
