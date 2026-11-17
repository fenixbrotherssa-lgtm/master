// impresoras.js — "Impresoras de este equipo" (2.1.4). La configuración vive en este equipo (modules/impresion.js).
const Impresion = require('./impresion');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Qué tipos tienen sentido para cada uso
const TIPOS_POR_USO = {
    RECIBO: ['NAVEGADOR', 'TERMICA80', 'TERMICA58', 'MATRICIAL'],
    COCINA: ['NAVEGADOR', 'TERMICA80', 'TERMICA58', 'MATRICIAL'],
    ETIQUETA: ['NAVEGADOR', 'ETIQUETA_TSPL'],
    DOCUMENTO: ['NAVEGADOR']
};

const ImpresorasModule = {
    _lista: [],

    async init() {
        window.ImpresorasModule = this;
        this._lista = await Impresion.impresoras();
        this.pintar();
    },

    pintar() {
        const grid = document.getElementById('imp-grid');
        if (!grid) return;
        grid.innerHTML = Object.keys(Impresion.USOS).map(uso => this.tarjeta(uso)).join('');
        Object.keys(Impresion.USOS).forEach(uso => this.mostrarCampos(uso));
    },

    tarjeta(uso) {
        const u = Impresion.USOS[uso];
        const c = Impresion.config(uso);
        const opcionesImp = ['<option value="">— Elegir impresora —</option>']
            .concat(this._lista.map(p => `<option value="${esc(p.nombre)}" ${p.nombre === c.impresora ? 'selected' : ''}>${esc(p.nombre)}${p.predeterminada ? ' (predeterminada)' : ''}</option>`));
        if (c.impresora && !this._lista.some(p => p.nombre === c.impresora))
            opcionesImp.push(`<option value="${esc(c.impresora)}" selected>${esc(c.impresora)} (no conectada)</option>`);
        const tipos = TIPOS_POR_USO[uso].map(t => `<option value="${t}" ${t === c.tipo ? 'selected' : ''}>${esc(Impresion.TIPOS[t].label)}</option>`).join('');
        const chk = (k, txt) => `<label><input type="checkbox" data-k="${k}" ${c[k] ? 'checked' : ''} onchange="ImpresorasModule.guardar('${uso}')"> ${txt}</label>`;
        const num = (k, txt, min, max) => `<div class="imp-campo"><label>${txt}</label><input type="number" data-k="${k}" min="${min}" max="${max}" value="${esc(c[k])}" onchange="ImpresorasModule.guardar('${uso}')"></div>`;
        return `
        <div class="imp-card" id="imp-${uso}">
            <h3>${esc(u.label)}</h3>
            <div class="ayuda">${esc(u.ayuda)}</div>
            <div class="imp-campo"><label>Tipo</label>
                <select data-k="tipo" onchange="ImpresorasModule.cambioTipo('${uso}')">${tipos}</select></div>
            <div class="imp-campo imp-directa"><label>Impresora</label>
                <select data-k="impresora" onchange="ImpresorasModule.guardar('${uso}')">${opcionesImp.join('')}</select></div>
            <div class="imp-escpos">
                <div class="imp-fila2">
                    ${num('columnas', 'Caracteres por línea', 16, 64)}
                    ${num('copias', 'Copias', 1, 5)}
                    <div class="imp-campo"><label>Tildes y ñ</label>
                        <select data-k="tildes" onchange="ImpresorasModule.guardar('${uso}')">
                            <option value="PC850" ${c.tildes !== 'SIN' ? 'selected' : ''}>Con tildes</option>
                            <option value="SIN" ${c.tildes === 'SIN' ? 'selected' : ''}>Sin tildes (si salen símbolos raros)</option>
                        </select></div>
                </div>
                <div class="imp-check">${chk('cortar', 'Cortar papel')}</div>
            </div>
            <div class="imp-tspl">
                <div class="imp-fila2">
                    ${num('etqAncho', 'Ancho etiqueta (mm)', 20, 104)}
                    ${num('etqAlto', 'Alto etiqueta (mm)', 15, 200)}
                    ${num('etqDensidad', 'Intensidad (0-15)', 0, 15)}
                </div>
                <div class="ayuda">Al cambiar de rollo, calibre la impresora (herramienta del fabricante: Sensor Calibration → Gap).</div>
            </div>
            <div class="imp-btns imp-directa">
                <button class="imp-btn" onclick="ImpresorasModule.prueba('${uso}')"><i class="fas fa-print"></i> IMPRIMIR PRUEBA</button>
            </div>
            <div class="imp-estado" id="imp-estado-${uso}"></div>
        </div>`;
    },

    leerTarjeta(uso) {
        const el = document.getElementById(`imp-${uso}`);
        const cfg = {};
        el.querySelectorAll('[data-k]').forEach(i => {
            const k = i.getAttribute('data-k');
            if (i.type === 'checkbox') cfg[k] = i.checked;
            else if (i.type === 'number') cfg[k] = parseInt(i.value, 10) || 0;
            else cfg[k] = i.value;
        });
        return cfg;
    },

    cambioTipo(uso) {
        const cfg = this.leerTarjeta(uso);
        const t = Impresion.TIPOS[cfg.tipo];
        if (t && t.columnas) cfg.columnas = t.columnas;              // al cambiar de tipo, columnas típicas del tipo
        Impresion.guardar(uso, cfg);
        const el = document.getElementById(`imp-${uso}`);
        const col = el.querySelector('[data-k="columnas"]');
        if (col && t && t.columnas) col.value = t.columnas;
        this.mostrarCampos(uso);
        this.estado(uso, 'Guardado', '#2f855a');
    },

    guardar(uso) {
        Impresion.guardar(uso, this.leerTarjeta(uso));
        this.estado(uso, 'Guardado', '#2f855a');
    },

    mostrarCampos(uso) {
        const el = document.getElementById(`imp-${uso}`);
        if (!el) return;
        const tipo = Impresion.config(uso).tipo;
        const t = Impresion.TIPOS[tipo] || {};
        el.querySelectorAll('.imp-directa').forEach(x => x.classList.toggle('imp-oculto', !t.directo));
        el.querySelectorAll('.imp-escpos').forEach(x => x.classList.toggle('imp-oculto', !t.escpos));
        el.querySelectorAll('.imp-tspl').forEach(x => x.classList.toggle('imp-oculto', !t.tspl));
    },

    estado(uso, txt, color) {
        const e = document.getElementById(`imp-estado-${uso}`);
        if (e) { e.textContent = txt; e.style.color = color || '#4a5568'; }
    },

    async prueba(uso) {
        this.guardar(uso);
        this.estado(uso, 'Imprimiendo...', '#2b6cb0');
        try {
            await Impresion.prueba(uso);
            this.estado(uso, 'Prueba enviada. Revise que la regla quepa en una línea y que salgan las tildes.', '#2f855a');
        } catch (e) {
            this.estado(uso, e.message || 'No se pudo imprimir', '#c53030');
        }
    }
};

module.exports = ImpresorasModule;
