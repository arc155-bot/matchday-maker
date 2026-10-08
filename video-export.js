/* Fixed-timeline H.264/MP4 export for gallery and social-media uploads. */
(() => {
  'use strict';

  function toolkit() {
    if (!globalThis.Mediabunny) throw new Error('Videoexport konnte nicht geladen werden. Bitte die App neu laden.');
    return globalThis.Mediabunny;
  }

  function containerDurations(buffer) {
    const view = new DataView(buffer);
    const invalid = () => { throw new Error('Die Videodatei hat unvollständige Zeitangaben. Bitte den Export erneut starten.'); };
    const text = offset => String.fromCharCode(...new Uint8Array(buffer, offset, 4));
    const uint64 = offset => view.getUint32(offset) * 2 ** 32 + view.getUint32(offset + 4);
    function boxes(start, end) {
      const result = [];
      for (let offset = start; offset < end;) {
        if (offset + 8 > end) invalid();
        let size = view.getUint32(offset);
        const header = size === 1 ? 16 : 8;
        if (offset + header > end) invalid();
        if (size === 1) size = uint64(offset + 8);
        if (size === 0) size = end - offset;
        if (!Number.isSafeInteger(size) || size < header || offset + size > end) invalid();
        result.push({ type: text(offset + 4), start: offset + header, end: offset + size });
        offset += size;
      }
      return result;
    }
    function timeHeader(box, trackTimescale) {
      if (!box || box.start + 4 > box.end) invalid();
      const version = view.getUint8(box.start);
      if (version !== 0 && version !== 1) invalid();
      const wide = version === 1;
      const durationOffset = box.start + (trackTimescale ? (wide ? 28 : 20) : (wide ? 24 : 16));
      if (durationOffset + (wide ? 8 : 4) > box.end) invalid();
      const timescale = trackTimescale || view.getUint32(box.start + (wide ? 20 : 12));
      const ticks = wide ? uint64(durationOffset) : view.getUint32(durationOffset);
      if (!(timescale > 0) || !Number.isSafeInteger(ticks)) invalid();
      return { timescale, duration: ticks / timescale };
    }
    const moov = boxes(0, buffer.byteLength).find(box => box.type === 'moov');
    if (!moov) invalid();
    const children = boxes(moov.start, moov.end);
    const movie = timeHeader(children.find(box => box.type === 'mvhd'));
    const durations = [movie.duration];
    for (const track of children.filter(box => box.type === 'trak')) {
      const trackBoxes = boxes(track.start, track.end);
      const media = trackBoxes.find(box => box.type === 'mdia');
      if (!media) invalid();
      const mediaBoxes = boxes(media.start, media.end);
      const handler = mediaBoxes.find(box => box.type === 'hdlr');
      if (!handler || handler.start + 12 > handler.end) invalid();
      if (text(handler.start + 8) !== 'vide') continue;
      durations.push(timeHeader(trackBoxes.find(box => box.type === 'tkhd'), movie.timescale).duration);
    }
    if (durations.length < 2) invalid();
    return durations;
  }

  async function inspectMP4(buffer, { duration, frameCount, fps }) {
    const Media = toolkit();
    const input = new Media.Input({ source: new Media.BufferSource(buffer), formats: [Media.MP4] });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track || await track.getCodec() !== 'avc') throw new Error('Die MP4 enthält keine vollständige H.264-Videospur.');
      const declared = await input.getDurationFromMetadata();
      const declaredTrack = await track.getDurationFromMetadata();
      const actual = await input.computeDuration();
      const start = await track.getFirstTimestamp();
      const stats = await track.computePacketStats();
      const tolerance = 1 / fps + 0.001;
      // Some readers use mvhd/tkhd, while others use mdhd or packet timestamps.
      // All must describe the full movie, rather than just its first segment.
      if (![...containerDurations(buffer), declared, declaredTrack, actual].every(value => Number.isFinite(value) && Math.abs(value - duration) <= tolerance)
        || !Number.isFinite(start) || Math.abs(start) > tolerance || stats.packetCount !== frameCount) {
        throw new Error('Die Videodatei hat unvollständige Zeitangaben. Bitte den Export erneut starten.');
      }
      return { duration: actual, frameCount: stats.packetCount };
    } finally {
      input.dispose();
    }
  }

  async function encodeCanvas({ width, height, fps, duration, drawFrame, onProgress = () => {} }) {
    const Media = toolkit();
    const frameCount = Math.round(duration * fps);
    if (!(width > 0 && height > 0 && fps > 0 && frameCount > 0) || typeof drawFrame !== 'function') {
      throw new Error('Die Angaben für den Videoexport sind ungültig.');
    }
    const exactDuration = frameCount / fps;
    const options = [
      { width, height, bitrate: 9_000_000 },
      { width: 720, height: 1280, bitrate: 5_000_000 }
    ];
    let lastError = null;
    for (const size of options) {
      const quality = new Media.Quality({ bitrate: size.bitrate });
      if (!await Media.canEncodeVideo('avc', { width: size.width, height: size.height, frameRate: fps, quality })) continue;
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Der Zeichenbereich für das Video konnte nicht erstellt werden.');
      const target = new Media.BufferTarget();
      const output = new Media.Output({ target, format: new Media.Mp4OutputFormat({ fastStart: 'in-memory' }) });
      let encodedFrames = 0;
      try {
        const source = new Media.CanvasSource(canvas, {
          codec: 'avc', quality, keyFrameInterval: 1,
          onEncodedPacket: () => { encodedFrames += 1; }
        });
        output.addVideoTrack(source, { frameRate: fps });
        await output.start();
        for (let frame = 0; frame < frameCount; frame += 1) {
          const timestamp = frame / fps;
          ctx.save();
          try {
            ctx.scale(size.width / width, size.height / height);
            drawFrame(ctx, timestamp);
          } finally {
            ctx.restore();
          }
          // Explicit timestamps cover the whole movie even on a slow phone or
          // in a background tab; they never depend on the recording wall clock.
          await source.add(timestamp, 1 / fps);
          if (frame % 8 === 0 || frame === frameCount - 1) {
            onProgress((frame + 1) / frameCount);
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }
        await output.finalize();
        if (!target.buffer?.byteLength || encodedFrames !== frameCount) throw new Error('Die MP4 konnte nicht vollständig erstellt werden.');
        const verified = await inspectMP4(target.buffer, { duration: exactDuration, frameCount, fps });
        return { blob: new Blob([target.buffer], { type: 'video/mp4' }), ...verified, width: size.width, height: size.height, fps };
      } catch (error) {
        lastError = error;
        if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => {});
      } finally {
        // Release the temporary pixel buffer; the normal preview stays intact.
        canvas.width = 0;
        canvas.height = 0;
      }
    }
    if (lastError) throw lastError;
    throw new Error('Dieser Browser kann keine MP4 erstellen. Bitte öffne die App in einem aktuellen Chrome-Browser.');
  }

  const api = { encodeCanvas, inspectMP4 };
  globalThis.MatchdayVideo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
