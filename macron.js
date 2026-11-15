// Macrons (ō, ū, ā…) are missing from the brush and hand fonts, so the browser
// swaps in a fallback face for just that letter. Instead we write the plain
// letter in the game font and paint the bar over it ourselves.
const MAC = { 'ā': 'a', 'Ā': 'A', 'ē': 'e', 'Ē': 'E', 'ī': 'i', 'Ī': 'I', 'ō': 'o', 'Ō': 'O', 'ū': 'u', 'Ū': 'U' };
const RE = /[āĀēĒīĪōŌūŪ]/g;

export const hasMacron = (s) => RE.test(s) && !(RE.lastIndex = 0);
export const stripMacrons = (s) => String(s).replace(RE, (c) => MAC[c]);

// HTML: the letter in a span whose ::after draws a short brushed bar (style.css .mac)
export function macronHTML(s) {
  return String(s).replace(RE, (c) => `<span class="mac">${MAC[c]}</span>`);
}

// Canvas: drop-in for ctx.fillText that paints the bars by hand, in the same
// fill style, respecting textAlign / textBaseline.
export function fillTextMacron(ctx, text, x, y) {
  text = String(text);
  const plain = stripMacrons(text);
  ctx.fillText(plain, x, y);
  if (plain === text) return;
  const total = ctx.measureText(plain).width, al = ctx.textAlign;
  const x0 = al === 'center' ? x - total / 2 : al === 'right' || al === 'end' ? x - total : x;
  const fs = parseFloat(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] || '16');
  for (let i = 0; i < text.length; i++) {
    if (text[i] === plain[i]) continue;
    const pre = ctx.measureText(plain.slice(0, i)).width, m = ctx.measureText(plain[i]);
    const top = y - (m.actualBoundingBoxAscent || fs * 0.5);
    const l = x0 + pre + m.width * 0.16, r = x0 + pre + m.width * 0.86, by = top - fs * 0.1, th = Math.max(1.8, fs * 0.1);
    // a tapered, slightly tilted brush stroke: thick at the entry, flicked off at the end
    ctx.beginPath();
    ctx.moveTo(l, by + th * 0.15);
    ctx.quadraticCurveTo((l + r) / 2, by - th * 0.75, r, by - th * 0.35);
    ctx.quadraticCurveTo(r + th * 0.2, by - th * 0.05, r - th * 0.3, by + th * 0.1);
    ctx.quadraticCurveTo((l + r) / 2, by + th * 0.35, l + th * 0.2, by + th * 0.85);
    ctx.quadraticCurveTo(l - th * 0.35, by + th * 0.6, l, by + th * 0.15);
    ctx.fill();
  }
}
