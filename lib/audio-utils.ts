"use client";

/**
 * Converts an audio Blob (like WebM/Opus) to PCM16 Int16Array
 * as required by Picovoice Eagle.
 */
export async function convertBlobToPCM16(blob: Blob): Promise<Int16Array> {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000, // Eagle requires 16000Hz
    });

    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Eagle requires mono 16000Hz
    const offlineContext = new OfflineAudioContext(
        1, // Mono
        audioBuffer.duration * 16000,
        16000
    );

    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start();

    const renderedBuffer = await offlineContext.startRendering();
    const channelData = renderedBuffer.getChannelData(0);

    // Convert Float32 to Int16
    const pcm16 = new Int16Array(channelData.length);
    for (let i = 0; i < channelData.length; i++) {
        const s = Math.max(-1, Math.min(1, channelData[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    await audioContext.close();
    return pcm16;
}
