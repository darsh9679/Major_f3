# Eagle Native Module Setup

## Issue
The error `File not found at 'libraryPath': ...\pv_eagle.node` occurs because Next.js tries to bundle native Node.js modules, which cannot be bundled.

## Solution Applied

1. **Updated `next.config.ts`**:
   - Added `@picovoice/eagle-node` to `serverExternalPackages`
   - Configured webpack to exclude the module from bundling
   - Added fallbacks for Node.js built-ins

2. **Updated API Routes**:
   - Changed to use `require()` instead of `import` for dynamic loading
   - Added error handling for module loading

## Next Steps

1. **Restart your dev server**:
   ```bash
   # Stop the current server (Ctrl+C)
   # Then restart:
   npm run dev
   ```

2. **Verify the binary exists**:
   The binary should be at:
   ```
   node_modules/@picovoice/eagle-node/lib/windows/amd64/pv_eagle.node
   ```

3. **If still having issues**:
   - Make sure you're on Windows x64 (amd64)
   - Try reinstalling: `npm uninstall @picovoice/eagle-node && npm install @picovoice/eagle-node`
   - Check that the path doesn't have special characters

## Alternative Solution

If the native module continues to cause issues, consider:
- Using a separate Node.js service for voice processing
- Using Docker to run the voice processing in a container
- Using Picovoice's cloud API instead of the local SDK

## Testing

After restarting, try:
1. Navigate to `/voice-enroll`
2. Click "Start Voice Enrollment"
3. The error should be resolved
