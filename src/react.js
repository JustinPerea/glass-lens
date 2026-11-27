// <GlassCanvas source shapes material />: a thin React wrapper over createGlass.
// React is a peer dependency; the core (glass-lens) doesn't import it.
import { createElement, forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createGlass } from './glass.js';

const isVideo = s => typeof HTMLVideoElement !== 'undefined' && s instanceof HTMLVideoElement;

/**
 * Props:
 *   source    image, video, canvas or ImageBitmap (an <img> still loading is awaited)
 *   shapes    [{ kind, x, y, w, h, r, material }], x and y are centres in CSS px
 *   material  preset id or settings object (default 'apple')
 *   live      redraw every frame (a canvas source you draw into); videos always do
 *   dpr       device px per CSS px (default min(devicePixelRatio, 2))
 *   fallback  what to render when WebGL2 is missing (default: nothing)
 *   onError   called with errors from createGlass or setSource
 * The ref is the glass instance (toBlob(), render(), info), or null.
 * Other props (className, style, aria-label…) go to the <canvas>.
 */
export const GlassCanvas = forwardRef(function GlassCanvas(props, ref) {
  const { source, shapes, material = 'apple', live = false, dpr, fallback = null, onError, ...rest } = props;
  const canvasRef = useRef(null);
  const glassRef = useRef(null);
  const errRef = useRef(onError); errRef.current = onError;
  const [glass, setGlass] = useState(null);
  const [failed, setFailed] = useState(false);

  useImperativeHandle(ref, () => glass, [glass]);

  // Create on mount, destroy on unmount. StrictMode mounts twice on one canvas; destroy()
  // keeps the WebGL context, so the second createGlass reuses it.
  useEffect(() => {
    let g;
    try { g = createGlass(canvasRef.current, { dpr }); }
    catch (e) { setFailed(true); errRef.current?.(e); return undefined; }
    glassRef.current = g; setGlass(g);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { g.resize(); g.render(); }) : null;
    ro?.observe(canvasRef.current);
    return () => { ro?.disconnect(); g.destroy(); glassRef.current = null; setGlass(null); };
  }, [dpr]);

  useEffect(() => {
    if (!glass) return;
    let cancelled = false;
    glass.setSource(source ?? null, { live }).then(() => { if (!cancelled) glass.render(); }, e => errRef.current?.(e));
    return () => { cancelled = true; };
  }, [glass, source, live]);

  useEffect(() => {
    if (!glass) return;
    try { glass.setShapes(shapes || []); glass.render(); } catch (e) { errRef.current?.(e); }
  }, [glass, shapes]);

  useEffect(() => {
    if (!glass) return;
    try { glass.setMaterial(material); glass.render(); } catch (e) { errRef.current?.(e); }
  }, [glass, material]);

  // Moving sources redraw every frame.
  useEffect(() => {
    if (!glass || !(live || isVideo(source))) return undefined;
    let id = requestAnimationFrame(function loop() { glass.render(); id = requestAnimationFrame(loop); });
    return () => cancelAnimationFrame(id);
  }, [glass, source, live]);

  if (failed) return fallback;
  return createElement('canvas', { ref: canvasRef, ...rest });
});
