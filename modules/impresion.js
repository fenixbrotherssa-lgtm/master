/* ============================================================================
 *  impresion.js — impresión directa por equipo (2.1.4)          window.Impresion
 *
 *  Cada computadora elige, para cada USO, una impresora y su TIPO:
 *    USOS:  RECIBO (caja, recepción, POS, parqueadero, restaurante) · COCINA (comandas) ·
 *           ETIQUETA (QR de activos, WiFi...) · DOCUMENTO (A4: reportes, arqueos)
 *    TIPOS: TERMICA80 · TERMICA58 · MATRICIAL (ESC/POS: Epson, 3nStar, Xprinter, Bixolon...)
 *           ETIQUETA_TSPL (3nStar LTT / 4BARCODE / TSC) · NAVEGADOR (cuadro de impresión, como siempre)
 *  Sin configurar = NAVEGADOR: todo sigue funcionando exactamente igual que antes.
 *
 *  Los tickets existentes (printTicket.js, HTML con .t-title .t-row .t-hr tablas...) se traducen
 *  solos a ESC/POS con desdeHTML(): no hay que reescribir cada pantalla.
 *  La configuración vive en este equipo (localStorage 'mh_impresion_v1'), no en el servidor.
 * ========================================================================== */

const CLAVE = 'mh_impresion_v1';

const USOS = {
    RECIBO:    { label: 'Recibos y tickets',     ayuda: 'Caja, recepción, POS, parqueadero, restaurante, código de habitación' },
    COCINA:    { label: 'Comandas de cocina/bar', ayuda: 'Pedidos que se envían a preparar' },
    ETIQUETA:  { label: 'Etiquetas',              ayuda: 'QR de activos, WiFi y QR del hotel' },
    DOCUMENTO: { label: 'Documentos (A4)',        ayuda: 'Reportes, arqueos y documentos de hoja completa' }
};

const TIPOS = {
    NAVEGADOR:     { label: 'Cuadro de impresión de Windows (como siempre)', directo: false },
    TERMICA80:     { label: 'Térmica 80 mm (ESC/POS)',  directo: true, columnas: 48, escpos: true, qr: true },
    TERMICA58:     { label: 'Térmica 58 mm (ESC/POS)',  directo: true, columnas: 32, escpos: true, qr: true },
    MATRICIAL:     { label: 'Matricial de tickets (ESC/POS, p. ej. Epson TM-U220)', directo: true, columnas: 40, escpos: true, qr: false },
    ETIQUETA_TSPL: { label: 'Etiquetadora TSPL (3nStar LTT / 4BARCODE / TSC)', directo: true, tspl: true }
};

// Valores por defecto de cada uso (los de la etiquetadora son los aprobados en la prueba del 2026-11-12)
const BASE = {
    impresora: '', tipo: 'NAVEGADOR', columnas: 0, cortar: true, cajon: false, copias: 1, tildes: 'PC850',
    etqAncho: 80, etqAlto: 50, etqMargen: 2, etqDensidad: 12, etqVelocidad: 3
};

function _leer() {
    try { return JSON.parse(localStorage.getItem(CLAVE) || '{}') || {}; } catch (_) { return {}; }
}
function config(uso) {
    const c = Object.assign({}, BASE, _leer()[uso] || {});
    const t = TIPOS[c.tipo] || TIPOS.NAVEGADOR;
    if (!c.columnas && t.columnas) c.columnas = t.columnas;
    return c;
}
function guardar(uso, cfg) {
    const todo = _leer();
    todo[uso] = Object.assign({}, BASE, todo[uso] || {}, cfg || {});
    try { localStorage.setItem(CLAVE, JSON.stringify(todo)); } catch (_) {}
    return todo[uso];
}
function esDirecta(uso) {
    const c = config(uso);
    return !!(c.impresora && TIPOS[c.tipo] && TIPOS[c.tipo].directo);
}

// ── Electron ────────────────────────────────────────────────────────────────
function _ipc() {
    try { return require('electron').ipcRenderer; } catch (_) { return null; }
}
async function impresoras() {
    const ipc = _ipc();
    if (!ipc) return [];
    try { return await ipc.invoke('mh:impresoras'); } catch (_) { return []; }
}
async function enviarBytes(impresora, bytes, documento) {
    const ipc = _ipc();
    if (!ipc) throw new Error('La impresión directa solo está disponible en la aplicación de escritorio.');
    const b64 = Buffer.from(bytes).toString('base64');
    return ipc.invoke('mh:imprimir-raw', impresora, b64, documento || 'MasterHotel');
}

// ── Texto: tildes y ñ en la tabla PC850 (ESC t 2). Lo que no está en la tabla se simplifica. ──
const CP850 = {
    'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'ç': 0x87, 'ê': 0x88, 'ë': 0x89, 'è': 0x8A,
    'ï': 0x8B, 'î': 0x8C, 'ì': 0x8D, 'Ä': 0x8E, 'É': 0x90, 'ô': 0x93, 'ö': 0x94, 'ò': 0x95, 'û': 0x96, 'ù': 0x97,
    'Ö': 0x99, 'Ü': 0x9A, '£': 0x9C, '×': 0x9E, 'á': 0xA0, 'í': 0xA1, 'ó': 0xA2, 'ú': 0xA3, 'ñ': 0xA4, 'Ñ': 0xA5,
    'ª': 0xA6, 'º': 0xA7, '¿': 0xA8, '½': 0xAB, '¼': 0xAC, '¡': 0xAD, '«': 0xAE, '»': 0xAF, 'Á': 0xB5, 'Â': 0xB6,
    'À': 0xB7, '¢': 0xBD, '¥': 0xBE, 'Ê': 0xD2, 'Ë': 0xD3, 'È': 0xD4, 'Í': 0xD6, 'Î': 0xD7, 'Ï': 0xD8, 'Ì': 0xDE,
    'Ó': 0xE0, 'Ô': 0xE2, 'Ò': 0xE3, 'Ú': 0xE9, 'Û': 0xEA, 'Ù': 0xEB, '°': 0xF8, '·': 0xFA, '±': 0xF1
};
const SIMPLE = { '—': '-', '–': '-', '…': '...', '“': '"', '”': '"', '‘': "'", '’': "'", '€': 'EUR', '•': '*', ' ': ' ' };
function normalizar(s) {
    return String(s == null ? '' : s).replace(/[—–…“”‘’€• ]/g, c => SIMPLE[c]).replace(/[\u{1F000}-\u{1FFFF}☀-➿️]/gu, '');
}
function sinTildes(s) {
    return normalizar(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ñ]/g, 'n').replace(/[Ñ]/g, 'N').replace(/[¿¡]/g, '');
}
function codificar(s, tildes) {
    const t = tildes === 'SIN' ? sinTildes(s) : normalizar(s);
    const out = [];
    for (const ch of t) {
        const c = ch.codePointAt(0);
        if (c < 0x80) out.push(c);
        else if (tildes !== 'SIN' && CP850[ch] != null) out.push(CP850[ch]);
        else out.push(...Buffer.from(sinTildes(ch) || '?', 'ascii'));
    }
    return out;
}
const largo = s => Array.from(normalizar(s)).length;

// Corta un texto en líneas de N caracteres respetando palabras
function envolver(texto, n) {
    const palabras = normalizar(texto).replace(/\s+/g, ' ').trim().split(' ');
    const lineas = [];
    let act = '';
    for (let p of palabras) {
        while (largo(p) > n) {                                    // palabra más larga que la línea
            if (act) { lineas.push(act); act = ''; }
            lineas.push(Array.from(p).slice(0, n).join('')); p = Array.from(p).slice(n).join('');
        }
        if (!act) act = p;
        else if (largo(act) + 1 + largo(p) <= n) act += ' ' + p;
        else { lineas.push(act); act = p; }
    }
    if (act) lineas.push(act);
    return lineas.length ? lineas : [''];
}

/* ── Modelo de ticket (independiente de la impresora) ─────────────────────
 *  [{ t:'titulo', texto }  { t:'texto', texto, centro, derecha, negrita, grande }
 *   { t:'fila', izq, der, negrita }  { t:'sep' }  { t:'espacio' }  { t:'qr', datos }]
 * ------------------------------------------------------------------------- */

// Traduce el HTML de printTicket (.t-title .t-center .t-right .t-b .t-row .t-hr .t-tot, tablas) al modelo
function desdeHTML(html) {
    const doc = new DOMParser().parseFromString(`<div id="r">${html}</div>`, 'text/html');
    const raiz = doc.getElementById('r');
    const BLOQUES = new Set(['DIV', 'P', 'HR', 'TABLE', 'TBODY', 'THEAD', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'SECTION', 'HEADER', 'FOOTER', 'BR']);
    const modelo = [];
    const tieneBloques = el => Array.from(el.children).some(c => BLOQUES.has(c.tagName));
    const texto = el => (el.textContent || '').replace(/\s+/g, ' ').trim();
    const estilo = (el, ctx) => {
        const cl = el.classList || { contains: () => false };
        const fs = parseFloat((el.style && el.style.fontSize) || '') || 0;
        return {
            centro: (ctx.centro || cl.contains('t-center') || cl.contains('text-center') || (el.style && el.style.textAlign === 'center')) && !cl.contains('t-right'),
            derecha: ctx.derecha || cl.contains('t-right') || (el.style && el.style.textAlign === 'right'),
            negrita: ctx.negrita || cl.contains('t-b') || cl.contains('t-tot') || cl.contains('bold') || cl.contains('section-title') ||
                     el.tagName === 'B' || el.tagName === 'STRONG' ||
                     (el.style && /bold|[6-9]00/.test(el.style.fontWeight || '')),
            grande: ctx.grande || cl.contains('t-title') || fs >= 1.4 || /^H[12]$/.test(el.tagName)
        };
    };
    const recorrer = (el, ctx) => {
        for (const n of Array.from(el.childNodes)) {
            if (n.nodeType === 3) {                                       // texto suelto entre bloques
                const t = n.textContent.replace(/\s+/g, ' ').trim();
                if (t) modelo.push(Object.assign({ t: 'texto', texto: t }, ctx));
                continue;
            }
            if (n.nodeType !== 1) continue;
            const tag = n.tagName;
            const cl = n.classList;
            if (tag === 'HR' || (cl.contains('hr') && !n.children.length && !texto(n))) { modelo.push({ t: 'sep' }); continue; }
            if (tag === 'BR') continue;
            if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'TITLE' || tag === 'META' || cl.contains('t-bar') || cl.contains('no-print')) continue;
            const c = estilo(n, ctx);
            if ((cl.contains('t-row') || cl.contains('flex')) && n.children.length >= 2) {
                modelo.push({ t: 'fila', izq: texto(n.children[0]), der: texto(n.children[n.children.length - 1]), negrita: c.negrita });
                continue;
            }
            if (tag === 'TABLE' || tag === 'TBODY' || tag === 'THEAD') { recorrer(n, c); continue; }
            if (tag === 'TR') {
                const celdas = Array.from(n.children).filter(x => x.tagName === 'TD' || x.tagName === 'TH').map(texto).filter(x => x !== '');
                const neg = c.negrita || cl.contains('t-tot');
                if (celdas.length >= 2) modelo.push({ t: 'fila', izq: celdas.slice(0, -1).join(' '), der: celdas[celdas.length - 1], negrita: neg });
                else if (celdas.length === 1) modelo.push({ t: 'texto', texto: celdas[0], negrita: neg });
                continue;
            }
            if (tieneBloques(n)) { recorrer(n, c); continue; }
            const t = texto(n);
            if (t) modelo.push(Object.assign({ t: c.grande ? 'titulo' : 'texto', texto: t }, c));
        }
    };
    recorrer(raiz, { centro: false, derecha: false, negrita: false, grande: false });
    return modelo;
}

// ── ESC/POS (térmicas y matriciales) ────────────────────────────────────────
const ESC = 0x1B, GS = 0x1D;
function escpos(modelo, cfg, opts) {
    opts = opts || {};
    const N = Math.max(16, parseInt(cfg.columnas, 10) || 40);
    const tipo = TIPOS[cfg.tipo] || TIPOS.TERMICA80;
    const b = [ESC, 0x40];                                                  // iniciar
    if (cfg.tildes !== 'SIN') b.push(ESC, 0x74, 0x02);                      // tabla PC850
    const txt = s => b.push(...codificar(s, cfg.tildes));
    const alinear = a => b.push(ESC, 0x61, a);                              // 0 izq · 1 centro · 2 der
    const modo = m => b.push(ESC, 0x21, m);                                 // 0x08 negrita · 0x30 doble
    for (const it of modelo) {
        if (it.t === 'sep') { alinear(0); modo(0); txt('-'.repeat(N) + '\n'); continue; }
        if (it.t === 'espacio') { txt('\n'); continue; }
        if (it.t === 'fila') {
            alinear(0); modo(it.negrita ? 0x08 : 0);
            const izq = normalizar(it.izq), der = normalizar(it.der);
            if (largo(izq) + 1 + largo(der) <= N) txt(izq + ' '.repeat(N - largo(izq) - largo(der)) + der + '\n');
            else {
                envolver(izq, N).forEach(l => txt(l + '\n'));
                envolver(der, N).forEach(l => txt(' '.repeat(Math.max(0, N - largo(l))) + l + '\n'));
            }
            modo(0);
            continue;
        }
        if (it.t === 'qr') {
            if (tipo.qr && it.datos) {
                const d = Buffer.from(String(it.datos), 'utf8');
                alinear(1);
                b.push(GS, 0x28, 0x6B, 4, 0, 0x31, 0x41, 0x32, 0x00);          // modelo 2
                b.push(GS, 0x28, 0x6B, 3, 0, 0x31, 0x43, cfg.columnas <= 32 ? 5 : 7);   // tamaño del módulo
                b.push(GS, 0x28, 0x6B, 3, 0, 0x31, 0x45, 0x31);                // corrección M
                const L = d.length + 3;
                b.push(GS, 0x28, 0x6B, L & 0xFF, L >> 8, 0x31, 0x50, 0x30, ...d);
                b.push(GS, 0x28, 0x6B, 3, 0, 0x31, 0x51, 0x30);                // imprimir
                txt('\n'); alinear(0);
            } else if (it.alternativo) {
                alinear(1); txt(it.alternativo + '\n'); alinear(0);
            }
            continue;
        }
        // titulo / texto
        const grande = it.t === 'titulo' || it.grande;
        const ancho = grande ? Math.floor(N / 2) : N;
        alinear(it.derecha ? 2 : (it.centro || it.t === 'titulo') ? 1 : 0);
        modo((grande ? 0x30 : 0) | (it.negrita || it.t === 'titulo' ? 0x08 : 0));
        envolver(it.texto, ancho).forEach(l => txt(l + '\n'));
        modo(0);
    }
    alinear(0);
    b.push(ESC, 0x64, cfg.tipo === 'MATRICIAL' ? 6 : 4);                   // avance hasta la cuchilla
    if (cfg.cortar) b.push(GS, 0x56, 0x42, 0x00);
    if (cfg.cajon && opts.abrirCajon) b.push(ESC, 0x70, 0x00, 0x32, 0xFA);  // pulso al cajón de dinero
    return Uint8Array.from(b);
}

// ── Etiquetas TSPL ──────────────────────────────────────────────────────────
// NO se manda GAP: la separación entre etiquetas es la que midió la calibración de la impresora
// (forzar un GAP supuesto hacía que la siguiente etiqueta quedara entre dos — prueba del 2026-11-12).
function tsplCabecera(cfg) {
    return `SIZE ${cfg.etqAncho} mm,${cfg.etqAlto} mm\r\nDENSITY ${cfg.etqDensidad}\r\nSPEED ${cfg.etqVelocidad}\r\n` +
           `DIRECTION 1\r\nREFERENCE 0,0\r\nCLS\r\n`;
}
const tsplTexto = s => sinTildes(s).replace(/"/g, "'");    // la letra interna de la impresora no trae tildes

/** Etiqueta con QR nativo (cuadrado y nítido) + líneas de texto a la derecha. */
function etiquetaQR(e, cfg) {
    const DP = 8;                                               // 203 dpi = 8 puntos por mm
    const W = cfg.etqAncho * DP, H = cfg.etqAlto * DP, M = cfg.etqMargen * DP;
    const alto = H - 2 * M;
    // tamaño de celda: el QR ocupa como máximo ~60 % del alto útil y del 45 % del ancho
    const datos = String(e.qr || '');
    const modulos = datos.length <= 20 ? 21 : datos.length <= 38 ? 25 : datos.length <= 61 ? 29 : datos.length <= 90 ? 33 : 37;
    const celda = Math.max(3, Math.min(12, Math.floor(Math.min(alto * 0.85, (W - 2 * M) * 0.45) / (modulos + 2))));
    const lado = celda * modulos;
    const qx = M + 2 * DP, qy = M + Math.max(0, Math.floor((alto - lado) / 2));
    let s = tsplCabecera(cfg);
    if (e.marco) s += `BOX ${M},${M},${W - M},${H - M},3\r\n`;
    s += `QRCODE ${qx},${qy},M,${celda},A,0,"${datos.replace(/"/g, "'")}"\r\n`;
    const tx = qx + lado + 3 * DP;
    const lineas = (e.lineas || []).filter(Boolean);
    let ty = M + 3 * DP;
    for (const l of lineas) {
        const grande = typeof l === 'object' && l.grande;
        const t = typeof l === 'object' ? l.texto : l;
        const fuente = grande ? '3' : '2', paso = grande ? 34 : 26;
        const maxCar = Math.max(4, Math.floor((W - M - tx) / (grande ? 16 : 12)));
        for (const trozo of envolver(t, maxCar).slice(0, 2)) {
            if (ty + paso > H - M) break;
            s += `TEXT ${tx},${ty},"${fuente}",0,1,1,"${tsplTexto(trozo)}"\r\n`;
            ty += paso;
        }
        ty += 4;
    }
    s += `PRINT 1,${Math.max(1, parseInt(e.copias || cfg.copias, 10) || 1)}\r\n`;
    return Uint8Array.from(Buffer.from(s, 'ascii'));
}

// ── Imprimir ────────────────────────────────────────────────────────────────
/**
 * Imprime un ticket. `contenido`: HTML de printTicket o un modelo (arreglo). Si el uso no tiene impresora
 * directa devuelve false y quien llama sigue con el camino de siempre (cuadro de impresión).
 */
async function ticket(uso, contenido, opts) {
    opts = opts || {};
    const cfg = config(uso);
    if (!esDirecta(uso) || !TIPOS[cfg.tipo].escpos) return false;
    const modelo = Array.isArray(contenido) ? contenido : desdeHTML(contenido);
    const bytes = escpos(modelo, cfg, opts);
    const copias = Math.max(1, Math.min(5, parseInt(opts.copias || cfg.copias, 10) || 1));
    for (let i = 0; i < copias; i++) await enviarBytes(cfg.impresora, bytes, opts.titulo);
    return true;
}

/** Para pantallas que arman su propia ventana de impresión: si hay impresora directa la usa y devuelve true. */
async function directo(uso, html, titulo) {
    if (!esDirecta(uso)) return false;
    try {
        await ticket(uso, html, { titulo });
        if (typeof window !== 'undefined' && window.Toast) window.Toast.fire({ icon: 'success', title: 'Enviado a la impresora' });
        return true;
    } catch (e) {
        if (typeof window !== 'undefined' && window.Toast)
            window.Toast.fire({ icon: 'warning', title: 'No se pudo imprimir directo: se abre el cuadro de impresión', text: e.message || '' });
        return false;
    }
}

async function etiqueta(e, opts) {
    const cfg = Object.assign(config('ETIQUETA'), opts || {});
    if (!cfg.impresora || cfg.tipo !== 'ETIQUETA_TSPL') throw new Error('Configure la etiquetadora en "Impresoras de este equipo".');
    await enviarBytes(cfg.impresora, etiquetaQR(e, cfg), 'Etiqueta');
    return true;
}

async function prueba(uso) {
    const cfg = config(uso);
    if (!cfg.impresora) throw new Error('Elija primero la impresora.');
    const hoy = new Date().toLocaleString('es-EC');
    if (cfg.tipo === 'ETIQUETA_TSPL') {
        return etiqueta({ qr: 'PRUEBA-MASTERHOTEL', marco: true, lineas: [{ texto: 'MASTERHOTEL', grande: true }, 'Prueba de etiqueta',
            `${cfg.etqAncho} x ${cfg.etqAlto} mm`, `Intensidad ${cfg.etqDensidad}`] });
    }
    if (!TIPOS[cfg.tipo] || !TIPOS[cfg.tipo].escpos) throw new Error('Este tipo usa el cuadro de impresión de Windows: no necesita prueba aquí.');
    const N = cfg.columnas;
    const regla = Array.from({ length: N }, (_, i) => String((i + 1) % 10)).join('');
    return ticket(uso, [
        { t: 'titulo', texto: 'MASTERHOTEL' },
        { t: 'texto', texto: `Prueba: ${USOS[uso].label}`, centro: true },
        { t: 'sep' },
        { t: 'texto', texto: regla },
        { t: 'texto', texto: `La regla debe caber en una línea (${N} caracteres).` },
        { t: 'sep' },
        { t: 'fila', izq: 'Habitación 101', der: '$ 45,00' },
        { t: 'fila', izq: 'Café y pan', der: '$ 3,50' },
        { t: 'fila', izq: 'TOTAL', der: '$ 48,50', negrita: true },
        { t: 'texto', texto: 'Tildes: áéíóú ÁÉÍÓÚ ñÑ ¿? ¡!' },
        { t: 'qr', datos: 'https://www.casrodsoft.com', alternativo: '' },
        { t: 'texto', texto: hoy, centro: true }
    ], { titulo: 'Prueba de impresora' });
}

module.exports = { USOS, TIPOS, config, guardar, esDirecta, impresoras, enviarBytes, desdeHTML, escpos, etiquetaQR,
                   ticket, directo, etiqueta, prueba, envolver, codificar };
if (typeof window !== 'undefined') window.Impresion = module.exports;
