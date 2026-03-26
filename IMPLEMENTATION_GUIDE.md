# Picovoice Eagle Voice Recognition Integration Guide

## Overview
This guide explains how to integrate Picovoice Eagle for voice recognition during interviews to detect if someone other than the enrolled user is speaking.

## Architecture

### Components Created:
1. **Voice Enrollment** (`components/VoiceEnrollment.tsx`)
   - UI component for enrolling user's voice
   - Captures 30 seconds of audio
   - Shows progress during enrollment

2. **Voice Recognition** (`lib/eagle/recognition.ts`)
   - Real-time voice monitoring during calls
   - `VoiceMonitor` class for continuous monitoring
   - Sends audio chunks to server for processing

3. **Server APIs**:
   - `/api/eagle/enroll` - Handles voice enrollment
   - `/api/eagle/recognize` - Processes audio chunks for recognition

4. **Agent Integration** (`components/Agent.tsx`)
   - Automatically starts voice monitoring when call begins
   - Shows warnings when voice mismatch is detected
   - Stops monitoring when call ends

## Setup Instructions

### 1. Install Dependencies
```bash
npm install @picovoice/eagle-node
```

### 2. Get Picovoice Access Key
1. Sign up at https://console.picovoice.ai/
2. Get your free AccessKey
3. Add to `.env.local`:
```
PICOVOICE_ACCESS_KEY=your_access_key_here
```

### 3. Implement Audio Conversion
**IMPORTANT**: The current implementation has placeholder functions for audio conversion. You need to implement proper WebM to PCM16 conversion.

#### Option A: Use `web-audio-api` (Recommended for Node.js)
```bash
npm install web-audio-api
```

Then update `app/api/eagle/enroll/route.ts` and `app/api/eagle/recognize/route.ts` to use proper audio decoding.

#### Option B: Use FFmpeg (More robust)
```bash
npm install fluent-ffmpeg
```

### 4. Add Voice Enrollment Page
Create a page where users can enroll their voice before interviews:

```tsx
// app/(root)/voice-enroll/page.tsx
import VoiceEnrollment from "@/components/VoiceEnrollment";
import { getCurrentUser } from "@/lib/actions/auth.action";

export default async function VoiceEnrollPage() {
  const user = await getCurrentUser();
  
  if (!user) {
    redirect("/sign-in");
  }

  return (
    <div className="container mx-auto p-8">
      <VoiceEnrollment 
        userId={user.id}
        onComplete={(success) => {
          if (success) {
            router.push("/");
          }
        }}
      />
    </div>
  );
}
```

## How It Works

### Enrollment Flow:
1. User visits voice enrollment page
2. Clicks "Start Voice Enrollment"
3. Records 30 seconds of audio
4. Audio is sent to server
5. Server processes audio with Eagle Profiler
6. Speaker profile is saved to Firestore

### Recognition Flow:
1. User starts an interview
2. `VoiceMonitor` automatically starts
3. Every 2 seconds, captures audio chunk
4. Sends chunk to server for recognition
5. Server compares with enrolled profile
6. If similarity < 0.3, shows warning
7. Monitoring stops when call ends

## Configuration

### Voice Monitor Settings:
- `threshold`: 0.5 - Minimum similarity to consider a match
- `checkInterval`: 2000ms - How often to check voice
- `warningThreshold`: 0.3 - When to show warning

Adjust these in `components/Agent.tsx`:
```typescript
const monitor = new VoiceMonitor(
  userId,
  {
    threshold: 0.5,        // Adjust as needed
    checkInterval: 2000,    // Check every 2 seconds
    warningThreshold: 0.3,  // Show warning below 30% similarity
  },
  onWarning
);
```

## Important Notes

### Audio Format Requirements:
- **Sample Rate**: 16kHz (Eagle requirement)
- **Channels**: Mono (1 channel)
- **Format**: PCM16 (16-bit linear PCM)
- **Frame Length**: Determined by Eagle (typically 512 samples)

### Current Limitations:
1. **Audio Conversion**: WebM to PCM16 conversion is not yet implemented
   - You need to add proper audio decoding
   - Consider using `web-audio-api` or FFmpeg

2. **Browser Compatibility**: 
   - MediaRecorder API works in modern browsers
   - May need polyfills for older browsers

3. **Performance**:
   - Processing happens server-side
   - Consider rate limiting to avoid overload
   - May want to batch audio chunks

### Security Considerations:
1. Store voice profiles securely in Firestore
2. Only allow users to access their own profiles
3. Consider encrypting voice profiles
4. Implement rate limiting on API endpoints

## Testing

### Test Enrollment:
1. Navigate to voice enrollment page
2. Click "Start Voice Enrollment"
3. Speak naturally for 30 seconds
4. Verify profile is saved in Firestore

### Test Recognition:
1. Start an interview
2. Speak normally - should not show warnings
3. Have someone else speak - should show warning
4. Check console logs for similarity scores

## Troubleshooting

### "Picovoice access key not configured"
- Add `PICOVOICE_ACCESS_KEY` to `.env.local`

### "Audio conversion not implemented"
- Implement WebM to PCM16 conversion
- See "Implement Audio Conversion" section above

### "Voice profile not found"
- User needs to enroll voice first
- Redirect to enrollment page

### Low similarity scores:
- Ensure good audio quality (quiet environment)
- Check microphone settings
- Adjust `warningThreshold` if too sensitive

## Next Steps

1. ✅ Install Eagle SDK
2. ✅ Create enrollment component
3. ✅ Create recognition API
4. ✅ Integrate with Agent component
5. ⚠️ **Implement audio conversion** (REQUIRED)
6. ⚠️ **Add enrollment page** (REQUIRED)
7. ⚠️ **Test and tune thresholds**
8. ⚠️ **Add error handling**
9. ⚠️ **Add user feedback**

## Resources

- [Picovoice Eagle Docs](https://picovoice.ai/docs/eagle/)
- [Picovoice Console](https://console.picovoice.ai/)
- [Eagle Node.js SDK](https://www.npmjs.com/package/@picovoice/eagle-node)
