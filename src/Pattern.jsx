// Fondo de "lluvia" animada: 12 columnas de estelas verde suave que caen a
// distinta velocidad sobre blanco, con una rejilla de puntos encima.
// Los estilos van en línea (más un <style> para los @keyframes) para no
// depender de styled-components.

const COLOR = '#63d199';
const TILE_W = 300;

// Por columna: alto del tile, posición Y inicial y posición Y final de la animación.
const COLUMNS = [
  { h: 235, y0: 220, y1: 6800 },
  { h: 252, y0: 24, y1: 13632 },
  { h: 150, y0: 16, y1: 5416 },
  { h: 253, y0: 224, y1: 17175 },
  { h: 204, y0: 19, y1: 5119 },
  { h: 134, y0: 120, y1: 8428 },
  { h: 179, y0: 31, y1: 9876 },
  { h: 299, y0: 235, y1: 13391 },
  { h: 215, y0: 121, y1: 14741 },
  { h: 281, y0: 224, y1: 18770 },
  { h: 158, y0: 26, y1: 5082 },
  { h: 210, y0: 75, y1: 6375 },
];

// Cada columna son 3 capas: dos estelas verticales (bordes izquierdo y
// derecho del tile, así se repite sin costura) y un punto al centro.
const streak = (x, h) => `radial-gradient(4px 100px at ${x}px ${h}px, ${COLOR}, #0000)`;
const dot = (h) => `radial-gradient(1.5px 1.5px at ${TILE_W / 2}px ${h / 2}px, ${COLOR} 100%, #0000 150%)`;

const backgroundImage = COLUMNS.flatMap(({ h }) => [streak(0, h), streak(TILE_W, h), dot(h)]).join(', ');
const backgroundSize = COLUMNS.flatMap(({ h }) => Array(3).fill(`${TILE_W}px ${h}px`)).join(', ');

const positions = (key) =>
  COLUMNS.flatMap(({ h }, i) => {
    const x = i * 25;
    const y = COLUMNS[i][key];
    return [`${x}px ${y}px`, `${x + 3}px ${y}px`, `${x + TILE_W / 2 + 1.5}px ${y + h / 2}px`];
  }).join(', ');

const keyframes = `@keyframes rain-fall {
  0% { background-position: ${positions('y0')}; }
  to { background-position: ${positions('y1')}; }
}`;

const rainStyle = {
  position: 'relative',
  width: '100%',
  height: '100%',
  backgroundColor: '#fff',
  backgroundImage,
  backgroundSize,
  animation: 'rain-fall 150s linear infinite',
};

// Rejilla blanca con agujeros que dejan ver (desenfocadas) las estelas de atrás.
const gridStyle = {
  position: 'absolute',
  inset: 0,
  zIndex: 1,
  backgroundImage: 'radial-gradient(circle at 50% 50%, #0000 0, #0000 2px, #fff 2px)',
  backgroundSize: '8px 8px',
  backdropFilter: 'blur(0.3em)',
};

export default function Pattern() {
  return (
    <div aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: -1, overflow: 'hidden', background: '#fff' }}>
      <style>{keyframes}</style>
      <div style={rainStyle}>
        <div style={gridStyle} />
      </div>
    </div>
  );
}
