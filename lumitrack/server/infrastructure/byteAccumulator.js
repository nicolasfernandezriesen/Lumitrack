/** Acumulador de bytes con un único buffer crecible (evita chunks[] + Buffer.concat). */

export function createByteAccumulator(initialCapacity = 256 * 1024) {
  let buf = Buffer.allocUnsafe(Math.max(64, initialCapacity));
  let length = 0;

  function ensure(extra) {
    const need = length + extra;
    if (need <= buf.length) return;
    let next = buf.length;
    while (next < need) next *= 2;
    const grown = Buffer.allocUnsafe(next);
    buf.copy(grown, 0, 0, length);
    buf = grown;
  }

  return {
    get length() {
      return length;
    },
    push(chunk) {
      const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (!piece.length) return;
      ensure(piece.length);
      piece.copy(buf, length);
      length += piece.length;
    },
    /** Copia exacta para guardar en caché (libera el buffer sobredimensionado). */
    take() {
      const out = Buffer.allocUnsafe(length);
      if (length) buf.copy(out, 0, 0, length);
      return out;
    },
    /** Vista sin copiar; válida hasta el próximo push/take. */
    view() {
      return buf.subarray(0, length);
    },
  };
}
