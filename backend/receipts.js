// Recibo en PDF, generado al vuelo y descargable desde la pantalla de "pago exitoso" (GET /api/receipt/:sessionId).
const PDFDocument = require('pdfkit');
const { PLANS, money } = require('./plans');
const { SELLER, PUBLIC_URL } = require('./config');

const GREEN = '#099250';
const INK = '#181d27';
const MUTED = '#535862';
const LINE = '#e9eaeb';

const formatDateTime = (iso) =>
  new Date(iso).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'long', timeStyle: 'short' });

const formatDay = (yyyyMmDd) => {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
};

// Devuelve el PDF como Buffer. `status` casi siempre es 'paid' (así se descarga al confirmarse el cobro);
// 'pending' queda por si algún día hace falta un cobro manual, aunque hoy nada lo usa.
function buildReceipt(payment, status = payment.status === 'paid' ? 'paid' : 'pending') {
  const plan = PLANS[payment.plan];
  const doc = new PDFDocument({ size: 'LETTER', margin: 56, info: { Title: `Recibo ${payment.reference}`, Author: SELLER.name } });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const pageWidth = doc.page.width;
  const left = doc.page.margins.left;
  const contentWidth = pageWidth - left * 2;

  // Cabecera
  doc.rect(0, 0, pageWidth, 96).fill(GREEN);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(28).text(SELLER.name, left, 34);
  doc.font('Helvetica').fontSize(13).text('RECIBO', left, 42, { width: contentWidth, align: 'right' });

  // Número y estado
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(26).text(payment.reference, left, 128);
  const paid = status === 'paid';
  const label = paid ? 'PAGADO' : 'PENDIENTE DE PAGO';
  const chipWidth = doc.font('Helvetica-Bold').fontSize(10).widthOfString(label) + 24;
  doc.roundedRect(left, 168, chipWidth, 22, 11).fill(paid ? '#dcfae6' : '#fef0c7');
  doc.fillColor(paid ? '#067647' : '#b54708').text(label, left + 12, 174);

  // Datos
  const rows = [
    ['Fecha y hora', formatDateTime(payment.createdAt)],
    ...(payment.payerName ? [['Cliente', payment.payerName]] : []),
    ['Plan comprado', plan.name],
    ['Precio', money(payment.amount)],
    ['Período', plan.periodLabel],
    ['Vendedor', SELLER.name],
    ['Contacto', SELLER.contact],
  ];
  if (paid) {
    rows.push(['Pago confirmado', formatDateTime(payment.confirmedAt)]);
    rows.push(['Acceso hasta', payment.accessUntil ? formatDay(payment.accessUntil) : 'Sin vencimiento (de por vida)']);
  }

  let y = 218;
  doc.moveTo(left, y - 8).lineTo(left + contentWidth, y - 8).strokeColor(LINE).lineWidth(1).stroke();
  for (const [key, value] of rows) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(key, left, y, { width: 150 });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(value, left + 160, y - 1, { width: contentWidth - 160 });
    y += 30;
    doc.moveTo(left, y - 8).lineTo(left + contentWidth, y - 8).strokeColor(LINE).stroke();
  }

  // Pie
  doc
    .fillColor(MUTED)
    .font('Helvetica')
    .fontSize(9)
    .text(`Este recibo no es un comprobante fiscal. Compra final; reembolso solo si la falla es nuestra. Términos: ${PUBLIC_URL}/legal. Dudas: ${SELLER.contact}`, left, doc.page.height - 80, { width: contentWidth, align: 'center' });

  doc.end();
  return finished;
}

module.exports = { buildReceipt };
