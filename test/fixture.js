// The pixel check's source image, drawn in canvas so it needs no photo: a light half with
// fine lines (which show the lens) and a dark block (where small glass turns dark).
export function drawFixture(w = 1600, h = 1000) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#F4F1E9'); g.addColorStop(0.6, '#DCE6F0'); g.addColorStop(1, '#B7C3D1');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  x.strokeStyle = '#2B2F33'; x.lineWidth = 2;
  for (let gx = 0; gx <= w * 0.62; gx += 22) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, h * 0.7); x.stroke(); }
  for (let gy = 0; gy <= h * 0.7; gy += 44) { x.beginPath(); x.moveTo(0, gy); x.lineTo(w * 0.62, gy); x.stroke(); }
  const blobs = [['#E8593C', 0.18, 0.3, 0.09], ['#1F8A70', 0.46, 0.52, 0.07], ['#F2C14E', 0.3, 0.62, 0.06]];
  for (const [col, cx, cy, r] of blobs) { x.fillStyle = col; x.beginPath(); x.arc(cx * w, cy * h, r * w, 0, Math.PI * 2); x.fill(); }
  x.fillStyle = '#111413'; x.fillRect(w * 0.64, h * 0.52, w * 0.36, h * 0.48);
  x.fillStyle = '#E8593C'; x.fillRect(w * 0.7, h * 0.7, w * 0.2, h * 0.02);
  x.fillStyle = '#111413'; x.font = `600 ${Math.round(h * 0.12)}px system-ui, sans-serif`;
  x.fillText('Liquid glass', w * 0.06, h * 0.86);
  return c;
}
