const SAMPLE_SIZE = 48; // downscale para performance
const SATURATION_BOOST_CAP = 1.6;

/** Extrae el color dominante; devuelve null si CORS impide leer el canvas. */
export function extractDominantColor(imgEl) {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const ctx = canvas.getContext("2d");

  try {
    ctx.drawImage(imgEl, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;

    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha < 128) continue;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count++;
    }

    if (count === 0) return null;

    return boostSaturation(
      Math.round(r / count),
      Math.round(g / count),
      Math.round(b / count)
    );
  } catch (err) {
    console.warn("No se pudo extraer color de la imagen:", err);
    return null;
  }
}

function boostSaturation(r, g, b) {
  const max = Math.max(r, g, b);
  const boost = max > 0 ? Math.min(255 / max, SATURATION_BOOST_CAP) : 1;
  return {
    r: Math.min(255, Math.round(r * boost)),
    g: Math.min(255, Math.round(g * boost)),
    b: Math.min(255, Math.round(b * boost)),
  };
}

export function complementary({ r, g, b }) {
  return { r: 255 - r, g: 255 - g, b: 255 - b };
}
