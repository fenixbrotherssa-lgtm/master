/* ============================================================================
 *  printTicket.js — impresión de recibos/tickets (térmica 58/80mm o A4)
 *  Uso:
 *      const pt = require('./printTicket');
 *      pt.imprimir(htmlInterno, { titulo:'Recibo', formato:'termica80' });
 *      pt.getFormato() / pt.setFormato('a4')
 *  Clases disponibles en el HTML: .t-center .t-right .t-b .t-sm .t-hr .t-row .t-title  y  table/td/.t-tot
 * ========================================================================== */

const FORMATOS = {
    termica80: { label: 'Térmica 80mm', ancho: '80mm',  mono: true,  fs: 12 },
    termica58: { label: 'Térmica 58mm', ancho: '58mm',  mono: true,  fs: 11 },
    a4:        { label: 'Hoja A4',       ancho: '190mm', mono: false, fs: 13 }
};

function getFormato() {
    try { return localStorage.getItem('print_formato') || 'termica80'; } catch (e) { return 'termica80'; }
}
function setFormato(f) {
    try { if (FORMATOS[f]) localStorage.setItem('print_formato', f); } catch (e) {}
}

function imprimir(contenidoHtml, opts) {
    opts = opts || {};
    const cfg = FORMATOS[opts.formato || getFormato()] || FORMATOS.termica80;
    const mono = cfg.mono;

    const w = window.open('', '_blank', 'width=460,height=700');
    if (!w) { alert('Habilita las ventanas emergentes para poder imprimir.'); return; }

    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${(opts.titulo || 'Impresión')}</title>
    <style>
      @page { size: ${cfg.ancho} auto; margin: ${mono ? '3mm' : '12mm'}; }
      * { box-sizing: border-box; }
      body { margin: 0 auto; color: #000; padding: ${mono ? '2mm' : '0'};
             width: ${mono ? cfg.ancho : 'auto'};
             font-family: ${mono ? "'Consolas','Courier New',monospace" : "'Segoe UI',Arial,sans-serif"};
             font-size: ${cfg.fs}px; line-height: 1.35; }
      .t-center { text-align: center; } .t-right { text-align: right; } .t-b { font-weight: bold; }
      .t-sm { font-size: ${cfg.fs - 2}px; color: #222; }
      .t-hr { border: 0; border-top: 1px dashed #000; margin: 5px 0; }
      .t-row { display: flex; justify-content: space-between; gap: 8px; }
      .t-title { font-size: ${mono ? cfg.fs + 2 : cfg.fs + 6}px; font-weight: bold; margin: 0 0 2px; }
      table { width: 100%; border-collapse: collapse; }
      td { padding: 1px 0; vertical-align: top; }
      .t-tot td { font-weight: bold; font-size: ${cfg.fs + 1}px; }
      @media screen {
        body { max-width: ${mono ? '340px' : '820px'}; box-shadow: 0 0 12px #bbb; padding: 18px; margin: 22px auto; }
        .t-bar { position: sticky; top: 0; background: #1a365d; color: #fff; padding: 10px; text-align: center;
                 cursor: pointer; font-weight: bold; border-radius: 6px; margin-bottom: 14px;
                 font-family: 'Segoe UI', Arial, sans-serif; }
      }
      @media print { .t-bar { display: none; } }
    </style></head><body>
      <div class="t-bar" onclick="window.print()">🖨️&nbsp; CLIC PARA IMPRIMIR</div>
      ${contenidoHtml}
      <script>setTimeout(function () { try { window.print(); } catch (e) {} }, ${mono ? 250 : 450});<\/script>
    </body></html>`);
    w.document.close();
}

// Selector <select> reutilizable para elegir el formato (se auto-guarda)
function selectorHTML(id) {
    id = id || 'sel-formato-print';
    const cur = getFormato();
    return `<select id="${id}" title="Formato de impresión" onchange="window.PrintTicket.setFormato(this.value)"
        style="padding:8px 10px; border-radius:10px; border:1px solid #ccc; font-weight:700; font-size:.78rem;">
        ${Object.keys(FORMATOS).map(k => `<option value="${k}" ${k === cur ? 'selected' : ''}>${FORMATOS[k].label}</option>`).join('')}
    </select>`;
}

module.exports = { imprimir, getFormato, setFormato, selectorHTML, FORMATOS };
if (typeof window !== 'undefined') window.PrintTicket = module.exports;
