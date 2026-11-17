// agenda-movil.js — Agenda en el celular (2.4.0). Solo lectura, mismo endpoint que el escritorio:
// GET /api/planner/:sedeId?desde&hasta. Por día: ocupación de la noche, llegadas, salidas, en casa y reservas sin
// habitación; y una grilla compacta habitación × 7 días. Las fechas llegan como texto del servidor y se leen a mano.
const api = require('./api');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pad = n => String(n).padStart(2, '0');
const txt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const leer = t => { const [y, m, d] = String(t).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const sumar = (t, n) => { const d = leer(t); d.setDate(d.getDate() + n); return txt(d); };
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
function sedeActual() { let u = {}; try { u = JSON.parse(localStorage.getItem('user')) || {}; } catch (e) { /* */ } return localStorage.getItem('currentSedeId') || u.SedeID || ''; }

const AgendaMovilModule = {
    inicio: null,      // primer día de la tira (14 días)
    dia: null,         // día seleccionado
    datos: null,

    async init() {
        window.AgendaMovilModule = this;
        const hoy = txt(new Date());
        this.inicio = hoy; this.dia = hoy;
        await this.cargar();
    },

    async cargar() {
        const root = document.getElementById('ag-root');
        if (!root) return;
        try {
            const { data } = await api.get(`/planner/${sedeActual()}?desde=${this.inicio}&hasta=${sumar(this.inicio, 13)}`);
            this.datos = data;
            this.preparar();
            this.render();
        } catch (e) {
            root.innerHTML = `<div style="padding:30px;text-align:center;color:#c05621;font-weight:800;">${esc(e.response?.data?.error || 'No se pudo cargar la agenda')}</div>`;
        }
    },

    mover(n) { this.inicio = sumar(this.inicio, n); this.dia = this.inicio; this.cargar(); },
    elegir(d) { this.dia = d; this.render(); },

    // Misma regla que la agenda de escritorio (planner.js): un folio abierto solo es "en casa" si es el ÚLTIMO de su
    // habitación (o cama) y esta figura OCUPADA; si no, es un folio que nunca se cerró (dato a revisar) y no ocupa.
    // Quien sigue en casa con la salida vencida ocupa hasta hoy (su noche de hoy cuenta).
    preparar() {
        const D = this.datos, hoy = txt(new Date());
        const estado = {};
        (D.habitaciones || []).forEach(h => { estado[h.HabitacionID + '|'] = h.Estado; });
        (D.camas || []).forEach(c => { estado[c.HabitacionID + '|' + c.CamaID] = c.Estado; });
        const k = e => e.HabitacionID + '|' + (e.CamaID || '');
        const grupos = {};
        (D.estancias || []).forEach(e => (grupos[k(e)] = grupos[k(e)] || []).push(e));
        let revisar = 0;
        for (const lista of Object.values(grupos)) {
            lista.sort((a, b) => String(a.Inicio).localeCompare(String(b.Inicio)));
            lista.forEach((e, i) => {
                const sig = lista[i + 1];
                e._abandonado = !!e.EnCasa && (!!sig || estado[k(e)] !== 'OCUPADA');
                if (e._abandonado) revisar++;
                const prog = String(e.FinProgramado || e.Fin).slice(0, 10);
                e._fin = !e.EnCasa ? String(e.Fin).slice(0, 10) : (prog > hoy ? prog : sumar(hoy, 1));
            });
        }
        this._revisar = revisar;
    },

    // ¿La estadía ocupa la NOCHE del día d? (entró ese día o antes y sale después de ese día)
    cubreNoche(e, d) {
        if (String(e.TipoAlquiler || '').toUpperCase() === 'MOMENTO' || e._abandonado) return false;
        return String(e.Inicio).slice(0, 10) <= d && e._fin > d;
    },
    reservaNoche(r, d) { return r.Llegada <= d && r.Salida > d; },

    render() {
        const root = document.getElementById('ag-root');
        const D = this.datos; if (!root || !D) return;
        const d = this.dia, hoy = txt(new Date());
        const habs = D.habitaciones || [], est = D.estancias || [], resv = D.reservas || [];
        const totalHabs = habs.length || 1;

        const dias = [...Array(14)].map((_, i) => sumar(this.inicio, i));
        const tira = dias.map(x => {
            const ocup = new Set(est.filter(e => this.cubreNoche(e, x)).map(e => e.HabitacionID)).size;
            const pr = resv.filter(r => this.reservaNoche(r, x)).length;
            const pct = Math.min(100, Math.round((ocup + pr) * 100 / totalHabs));
            const f = leer(x);
            return `<div class="ag-dia ${x === d ? 'on' : ''} ${x === hoy ? 'hoy' : ''}" onclick="AgendaMovilModule.elegir('${x}')">
                <small>${DIAS[f.getDay()]}</small><b>${f.getDate()}</b><div class="ag-barra"><i style="width:${pct}%"></i></div><small>${pct}%</small></div>`;
        }).join('');

        const llegEst = est.filter(e => String(e.Inicio).slice(0, 10) === d);
        const llegRes = resv.filter(r => r.Llegada === d);
        const salen = est.filter(e => !e._abandonado && (String(e.FinProgramado || e.Fin).slice(0, 10) === d || (d === hoy && e.EnCasa && e.Vencida)));
        const enCasa = est.filter(e => this.cubreNoche(e, d));
        const sinHab = resv.filter(r => this.reservaNoche(r, d) && !r.HabitacionID);
        const nombreHab = id => { const h = habs.find(x => x.HabitacionID === id); return h ? h.NroHabitacion : '?'; };
        const ocupNoche = new Set(enCasa.map(e => e.HabitacionID)).size + resv.filter(r => this.reservaNoche(r, d)).length;

        const item = (izq, der, color) => `<div class="ag-item" style="border-left:4px solid ${color}"><div>${izq}</div><div style="text-align:right;font-size:.7rem;color:#718096;">${der}</div></div>`;
        const seccion = (titulo, lista) => `<div class="ag-sec">${titulo} <span>(${lista.length})</span></div>` + (lista.length ? lista.join('') : '<div class="ag-vacio">—</div>');

        // Grilla compacta: 7 días desde el día elegido
        const g7 = [...Array(7)].map((_, i) => sumar(d, i));
        const grilla = `<div class="ag-grilla"><table><tr><th></th>${g7.map(x => `<th>${DIAS[leer(x).getDay()]}<br>${leer(x).getDate()}</th>`).join('')}</tr>` +
            habs.map(h => `<tr><td class="h">${esc(h.NroHabitacion)}</td>${g7.map(x => {
                const e = est.find(z => z.HabitacionID === h.HabitacionID && this.cubreNoche(z, x));
                const r = !e && resv.find(z => z.HabitacionID === h.HabitacionID && this.reservaNoche(z, x));
                const c = e ? (e.Vencida ? '#9c4221' : '#c0392b') : r ? '#d69e2e' : '#e2e8f0';
                const t = e ? esc((e.Huesped || '').split(' ')[0]) : r ? esc((r.NombreReserva || '').split(' ')[0]) : '';
                return `<td><i style="background:${c}" title="${t}"></i></td>`;
            }).join('')}</tr>`).join('') + '</table></div>';

        root.innerHTML = `
            <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">
                <button class="ag-nav" onclick="AgendaMovilModule.mover(-7)">◀</button>
                <div class="ag-tira">${tira}</div>
                <button class="ag-nav" onclick="AgendaMovilModule.mover(7)">▶</button>
            </div>
            <div class="ag-res"><b style="text-transform:capitalize">${esc(leer(d).toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long' }))}</b>
                · noche: ${ocupNoche}/${habs.length} (${Math.round(ocupNoche * 100 / totalHabs)}%)</div>
            ${seccion('🛬 LLEGADAS', [
                ...llegEst.map(e => item(`<b>${esc(nombreHab(e.HabitacionID))}</b> ${esc(e.Huesped)}`, `${esc(String(e.Inicio).slice(11, 16))} · ${esc(e.TipoAlquiler || '')}`, '#2f855a')),
                ...llegRes.map(r => item(`<b>${r.HabitacionID ? esc(nombreHab(r.HabitacionID)) : esc(r.Tipo)}</b> ${esc(r.NombreReserva)}`, `reserva ${esc(r.CodigoReserva || '')} · ${esc(r.Estado)}${Number(r.Anticipo) > 0 ? ' · anticipo $' + Number(r.Anticipo).toFixed(2) : ''}`, '#d69e2e')),
            ])}
            ${seccion('🛫 SALIDAS', salen.map(e => item(`<b>${esc(nombreHab(e.HabitacionID))}</b> ${esc(e.Huesped)}`, `${esc(e.SalidaProgramadaFmt || '')}${e.EnCasa ? (e.Vencida ? ' · <b style="color:#9c4221">vencida</b>' : '') : ' · ya salió'}`, '#3182ce')))}
            ${seccion('🛏️ EN CASA ESA NOCHE', enCasa.map(e => item(`<b>${esc(nombreHab(e.HabitacionID))}</b> ${esc(e.Huesped)}`, `sale ${esc(e.SalidaProgramadaFmt || '')}${e.Vencida ? ' · <b style="color:#9c4221">vencida</b>' : ''}`, '#c0392b')))}
            ${sinHab.length ? seccion('⚠️ RESERVAS SIN HABITACIÓN', sinHab.map(r => item(`<b>${esc(r.Tipo)}</b> ${esc(r.NombreReserva)}`, `${esc(r.Llegada)} → ${esc(r.Salida)}`, '#d69e2e'))) : ''}
            ${this._revisar ? `<div style="font-size:.68rem;color:#975a16;margin-top:10px;">${this._revisar} folio(s) abiertos sin salida que no ocupan habitación (revisar en Recepción / Prueba de integridad); no se cuentan.</div>` : ''}
            <div class="ag-sec">GRILLA 7 DÍAS</div>${grilla}
            <div style="font-size:.66rem;color:#718096;margin-top:6px;">🟥 ocupada · 🟧 reservada · ⬜ libre</div>`;
    },
};

window.AgendaMovilModule = AgendaMovilModule;
module.exports = AgendaMovilModule;
