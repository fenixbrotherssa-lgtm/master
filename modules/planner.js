// planner.js — Agenda visual (2.2.0). Solo lectura: GET /api/planner/:sedeId?desde&hasta.
// Las fechas llegan como texto local del servidor ('yyyy-MM-ddTHH:mm'): se leen a mano, nunca con new Date(texto ISO)
// (evita corrimientos por zona horaria).
const api = require('./api');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const DIA_MS = 86400000;
const DIAS_SEM = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const ANCHO_DIA = { 7: 150, 14: 84, 31: 44 };
const ALTO_ITEM = 24;

// 'yyyy-MM-dd' o 'yyyy-MM-ddTHH:mm' → Date local
function leer(t, horaPorDefecto) {
    if (!t) return null;
    const m = String(t).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    if (!m) return null;
    const h = m[4] != null ? +m[4] : (horaPorDefecto || 0);
    return new Date(+m[1], +m[2] - 1, +m[3], h, m[5] != null ? +m[5] : 0);
}
const aTexto = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sumarDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const money = n => '$ ' + Number(n || 0).toFixed(2);

const PlannerModule = {
    _dias: 14,
    _ini: null,
    _datos: null,

    async init() {
        window.PlannerModule = this;
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
        this._ini = sumarDias(hoy, -2);                          // dos días atrás: se ve quién salió y quién llega
        this.marcarZoom();
        await this.cargar();
    },

    sede() {
        try {
            const u = JSON.parse(localStorage.getItem('user') || '{}');
            return localStorage.getItem('currentSedeId') || u.SedeID;
        } catch (_) { return localStorage.getItem('currentSedeId'); }
    },

    marcarZoom() {
        document.querySelectorAll('#seccion-planner [data-dias]').forEach(b => b.classList.toggle('on', +b.dataset.dias === this._dias));
        const f = document.getElementById('pl-fecha');
        if (f && this._ini) f.value = aTexto(this._ini);
    },
    zoom(d) { this._dias = d; this.marcarZoom(); this.cargar(); },
    mover(s) { this._ini = sumarDias(this._ini, s * Math.max(1, Math.round(this._dias / 2))); this.marcarZoom(); this.cargar(); },
    hoy() { const h = new Date(); h.setHours(0, 0, 0, 0); this._ini = sumarDias(h, -2); this.marcarZoom(); this.cargar(); },
    irA(v) { const d = leer(v); if (d) { this._ini = d; this.marcarZoom(); this.cargar(); } },

    async cargar() {
        const cont = document.getElementById('pl-cont');
        if (!cont) return;
        const desde = aTexto(this._ini), hasta = aTexto(sumarDias(this._ini, this._dias - 1));
        try {
            const { data } = await api.get(`/planner/${this.sede()}?desde=${desde}&hasta=${hasta}`);
            this._datos = data;
            this.llenarTipos();
            this.pintar();
        } catch (e) {
            cont.innerHTML = `<div class="pl-vacio">${esc(e.response?.data?.error || 'No se pudo cargar la agenda.')}</div>`;
        }
    },

    llenarTipos() {
        const sel = document.getElementById('pl-tipo');
        if (!sel || !this._datos) return;
        const actual = sel.value;
        const tipos = [...new Set(this._datos.habitaciones.map(h => h.Tipo))];
        sel.innerHTML = '<option value="">Todos los tipos</option>' + tipos.map(t => `<option ${t === actual ? 'selected' : ''}>${esc(t)}</option>`).join('');
    },

    // Reparte los elementos de una fila en carriles para que no se tapen; marca los que se cruzan.
    carriles(items) {
        items.sort((a, b) => a.ini - b.ini || b.fin - a.fin);
        const finCarril = [];
        for (const it of items) {
            let c = finCarril.findIndex(f => f <= it.ini);
            if (c === -1) { c = finCarril.length; finCarril.push(0); }
            it.carril = c;
            finCarril[c] = it.fin;
        }
        // cruce real (más de 1 h) entre dos ocupaciones de la MISMA habitación
        for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
            const a = items[i], b = items[j];
            if (b.ini >= a.fin || a.abandonado || b.abandonado) continue;     // un folio sin cerrar no es sobreventa
            if (Math.min(a.fin, b.fin) - Math.max(a.ini, b.ini) > 3600000) { a.choque = b.choque = true; }
        }
        return Math.max(1, finCarril.length);
    },

    pintar() {
        const d = this._datos, cont = document.getElementById('pl-cont');
        if (!d || !cont) return;
        const ini = leer(d.rango.Desde), dias = Math.round((sumarDias(leer(d.rango.Hasta), 1) - ini) / DIA_MS);
        const fin = sumarDias(ini, dias);
        const W = ANCHO_DIA[this._dias] || 84, anchoPista = W * dias;
        const ahora = leer(d.rango.Ahora);
        const x = t => Math.max(0, Math.min(anchoPista, (t - ini) / DIA_MS * W));
        const filtroTipo = (document.getElementById('pl-tipo') || {}).value || '';

        // Elementos por fila y reservas sin habitación por tipo. Fila = habitación, o CAMA en un dormitorio (2.3.0):
        // clave 'h<id>' / 'c<id>'. Lo de un dormitorio sin cama (historia anterior a venderlo por cama) va a la fila de la habitación.
        const porHab = {}, sinAsignar = {};
        const estadoHab = {};
        d.habitaciones.forEach(h => { estadoHab['h' + h.HabitacionID] = h.Estado; });
        (d.camas || []).forEach(c => { estadoHab['c' + c.CamaID] = c.Estado; });
        const clave = o => o.CamaID ? 'c' + o.CamaID : 'h' + o.HabitacionID;
        // Folio abierto "de verdad" = el ÚLTIMO de su habitación y la habitación figura OCUPADA: ese se estira hasta hoy.
        // Un folio abierto con otro huésped DESPUÉS en la misma habitación, o en una habitación que no está ocupada,
        // es un folio que nunca se cerró (dato a revisar), NO una sobreventa: se dibuja hasta su salida programada
        // (o hasta que entró el siguiente) y no se cuenta como cruce.
        const inicioSiguiente = {};
        const porHabOrden = {};
        for (const e of d.estancias) (porHabOrden[clave(e)] = porHabOrden[clave(e)] || []).push(e);
        for (const lista of Object.values(porHabOrden)) {
            lista.sort((a, b) => leer(a.Inicio) - leer(b.Inicio));
            lista.forEach((e, i) => { inicioSiguiente[e.RecepcionID] = lista[i + 1] ? +leer(lista[i + 1].Inicio) : null; });
        }
        let abandonados = 0;
        const idsAbandonados = new Set();
        for (const e of d.estancias) {
            const a = leer(e.Inicio);
            let b = leer(e.Fin);
            if (!a || !b) continue;
            const momento = e.TipoAlquiler === 'Momento';
            const sig = inicioSiguiente[e.RecepcionID];
            const abandonado = !!e.EnCasa && (sig != null || estadoHab[clave(e)] !== 'OCUPADA');
            if (abandonado) {
                abandonados++; idsAbandonados.add(e.RecepcionID);
                const prog = leer(e.FinProgramado) || b;
                b = new Date(Math.min(+prog, sig != null ? sig : +prog, +b));
            }
            const clase = abandonado ? 't-abierto' : momento ? 't-momento' : !e.EnCasa ? 't-salio' : e.Vencida ? 't-vencida' : e.SaleHoy ? 't-salehoy' : 't-encasa';
            const conSaldo = e.EstadoPago === 'Pendiente' || e.EstadoPago === 'Pago Parcial';
            (porHab[clave(e)] = porHab[clave(e)] || []).push({ tipo: 'E', d: e, ini: +a, fin: Math.max(+b, +a + 30 * 60000), clase, conSaldo,
                abandonado, texto: (abandonado ? '⚠ ' : '') + e.Huesped });
        }
        this._abandonados = abandonados;
        for (const r of d.reservas) {
            const a = leer(r.Llegada, 14), b = leer(r.Salida, 12);
            if (!a || !b) continue;
            const it = { tipo: 'R', d: r, ini: +a, fin: Math.max(+b, +a + 3600000), clase: r.Estado === 'CONFIRMADA' ? 't-confirmada' : 't-pendiente',
                texto: `${r.NombreReserva || 'Reserva'} · ${r.CodigoReserva || ''}` };
            if (r.HabitacionID || r.CamaID) (porHab[clave(r)] = porHab[clave(r)] || []).push(it);
            else (sinAsignar[r.Tipo] = sinAsignar[r.Tipo] || []).push(it);
        }

        // Encabezado de días
        let html = '<div class="pl-tabla"><div class="pl-head"><div class="pl-izq" style="font-weight:900;font-size:.74rem;">HABITACIÓN</div>';
        for (let i = 0; i < dias; i++) {
            const di = sumarDias(ini, i);
            const esHoy = ahora && aTexto(di) === aTexto(ahora);
            html += `<div class="pl-dia ${esHoy ? 'hoy' : ''}" style="width:${W}px">${di.getDate()}/${di.getMonth() + 1}<small>${DIAS_SEM[di.getDay()]}</small></div>`;
        }
        html += '</div>';

        const fondo = () => {
            let f = '';
            for (let i = 0; i < dias; i++) {
                const dd = sumarDias(ini, i).getDay();
                f += `<div class="pl-col ${dd === 0 || dd === 6 ? 'finde' : ''}" style="left:${i * W}px;width:${W}px"></div>`;
            }
            if (ahora && ahora >= ini && ahora < fin) f += `<div class="pl-ahora" style="left:${x(+ahora)}px"></div>`;
            return f;
        };
        const barra = (it) => {
            const izq = x(it.ini), der = x(it.fin);
            if (der <= 0 || izq >= anchoPista) return '';
            const ancho = Math.max(10, der - izq);
            const tt = it.tipo === 'E'
                ? `${it.d.Huesped} · ${it.d.TipoAlquiler} · entra ${it.d.EntradaFmt} · sale ${it.d.SalidaRealFmt || it.d.SalidaProgramadaFmt} · ${it.d.EstadoPago}`
                : `Reserva ${it.d.CodigoReserva} · ${it.d.NombreReserva} · ${it.d.Llegada} → ${it.d.Salida} · ${it.d.Estado} · ${it.d.Origen || ''}`;
            const idx = it.tipo === 'E' ? `E${it.d.RecepcionID}` : `R${it.d.ReservaID}`;
            return `<div class="pl-item ${it.clase} ${it.choque ? 'choque' : ''}" style="left:${izq}px;width:${ancho}px;top:${4 + it.carril * ALTO_ITEM}px"
                     title="${esc(tt)}" onclick="PlannerModule.detalle('${idx}')">${it.conSaldo ? '<span class="saldo">$</span>' : ''}${esc(it.texto)}</div>`;
        };
        const fila = (izqHtml, items) => {
            const n = this.carriles(items);
            const alto = 8 + n * ALTO_ITEM;
            return `<div class="pl-fila"><div class="pl-izq" style="height:${alto}px">${izqHtml}</div>
                    <div class="pl-pista" style="width:${anchoPista}px;height:${alto}px">${fondo()}${items.map(barra).join('')}</div></div>`;
        };

        // Agrupado por tipo
        const grupos = {};
        for (const h of d.habitaciones) (grupos[h.Tipo] = grupos[h.Tipo] || []).push(h);
        let enCasa = 0, llegan = 0, salen = 0, choques = 0;
        const hoyTxt = ahora ? aTexto(ahora) : '';
        for (const e of d.estancias) {
            if (idsAbandonados.has(e.RecepcionID)) continue;            // folio sin cerrar: no es un huésped en casa
            if (e.EnCasa && e.TipoAlquiler !== 'Momento') enCasa++; if (e.SaleHoy) salen++;
        }
        for (const r of d.reservas) if (r.Llegada === hoyTxt) llegan++;

        const colorEstado = { DISPONIBLE: '#38a169', OCUPADA: '#c53030', LIMPIEZA: '#d69e2e', MANTENIMIENTO: '#718096' };
        for (const tipo of Object.keys(grupos)) {
            if (filtroTipo && tipo !== filtroTipo) continue;
            const habs = grupos[tipo];
            const porCama = habs.some(h => h.UnidadVenta === 'CAMA');
            const camasTipo = porCama ? (d.camas || []).filter(c => habs.some(h => h.HabitacionID === c.HabitacionID)) : [];
            const libres = porCama ? camasTipo.filter(c => c.Estado === 'DISPONIBLE').length : habs.filter(h => h.Estado === 'DISPONIBLE').length;
            html += `<div class="pl-grupo"><div class="pl-izq">${esc(tipo)}</div>
                     <div class="pl-info">${porCama ? `${habs.length} dormitorio(s) · ${camasTipo.length} camas · ${libres} camas libres ahora`
                                                    : `${habs.length} habitaciones · ${libres} disponibles ahora`}</div></div>`;
            for (const h of habs) {
                if (h.UnidadVenta === 'CAMA') {
                    // Dormitorio: una fila por cama (+ la de la habitación solo si tiene historia sin cama)
                    const propias = (d.camas || []).filter(c => c.HabitacionID === h.HabitacionID);
                    const sueltos = porHab['h' + h.HabitacionID] || [];
                    if (!propias.length || sueltos.length) {
                        html += fila(`<div class="pl-nro"><span class="pl-punto" style="background:${colorEstado[h.Estado] || '#a0aec0'}"></span>${esc(h.NroHabitacion)}</div>
                                      <div class="pl-sub">${propias.length ? 'habitación completa' : 'dormitorio sin camas creadas'}</div>`, sueltos);
                        choques += sueltos.filter(i => i.choque).length;
                    }
                    for (const c of propias) {
                        const items = porHab['c' + c.CamaID] || [];
                        html += fila(`<div class="pl-nro"><span class="pl-punto" style="background:${colorEstado[c.Estado] || '#a0aec0'}"></span>${esc(h.NroHabitacion)} · <span style="color:#6b46c1">Cama ${esc(c.Codigo)}</span></div>
                                      <div class="pl-sub">${esc(c.Descripcion || 'Piso ' + (h.Piso ?? '-'))} · ${esc((c.Estado || '').toLowerCase())}</div>`, items);
                        choques += items.filter(i => i.choque).length;
                    }
                    continue;
                }
                const items = porHab['h' + h.HabitacionID] || [];
                html += fila(`<div class="pl-nro"><span class="pl-punto" style="background:${colorEstado[h.Estado] || '#a0aec0'}"></span>${esc(h.NroHabitacion)}</div>
                              <div class="pl-sub">Piso ${esc(h.Piso ?? '-')} · ${esc((h.Estado || '').toLowerCase())}</div>`, items);
                choques += items.filter(i => i.choque).length;
            }
            if (sinAsignar[tipo] && sinAsignar[tipo].length)
                html += fila(`<div class="pl-nro" style="color:#2b6cb0;">Sin asignar</div><div class="pl-sub">Reservas de este tipo</div>`, sinAsignar[tipo]);
        }
        // Reservas de un tipo que no tiene habitaciones visibles
        for (const tipo of Object.keys(sinAsignar)) {
            if (grupos[tipo] || (filtroTipo && tipo !== filtroTipo)) continue;
            html += `<div class="pl-grupo"><div class="pl-izq">${esc(tipo)}</div><div class="pl-info">tipo sin habitaciones activas</div></div>`;
            html += fila(`<div class="pl-nro" style="color:#2b6cb0;">Sin asignar</div>`, sinAsignar[tipo]);
        }
        html += '</div>';
        cont.innerHTML = d.habitaciones.length ? html : '<div class="pl-vacio">Esta sede no tiene habitaciones activas.</div>';

        const res = document.getElementById('pl-resumen');
        if (res) res.innerHTML = `Hoy: <b>${enCasa}</b> en casa · <b>${llegan}</b> reservas llegan · <b>${salen}</b> salidas programadas` +
            (choques ? ` · <span style="color:#c53030">⚠ ${choques} ocupaciones se cruzan (posible sobreventa)</span>` : '') +
            (this._abandonados ? ` · <span style="color:#975a16">⚠ ${this._abandonados} folio(s) abierto(s) sin salida — cerrarlos en Recepción
                (Auditoría → Prueba de integridad los lista)</span>` : '');

        // Llevar la vista a hoy si está en el rango
        if (ahora && ahora >= ini && ahora < fin) cont.scrollLeft = Math.max(0, x(+ahora) - 200);
    },

    detalle(idx) {
        const d = this._datos;
        if (!d) return;
        if (idx[0] === 'E') {
            const e = d.estancias.find(x => `E${x.RecepcionID}` === idx);
            if (!e) return;
            const hab = d.habitaciones.find(h => h.HabitacionID === e.HabitacionID) || {};
            const cama = e.CamaID ? (d.camas || []).find(c => c.CamaID === e.CamaID) : null;
            Swal.fire({
                title: esc(e.Huesped),
                html: `<div style="text-align:left;line-height:1.8;font-size:.92rem;">
                    <b>Habitación:</b> ${esc(hab.NroHabitacion || e.HabitacionID)}${cama ? ` · <b>Cama ${esc(cama.Codigo)}</b>` : ''} (${esc(hab.Tipo || '')})<br>
                    <b>Alquiler:</b> ${esc(e.TipoAlquiler)} · ${e.Adultos} adulto(s)${e.Ninos ? ` · ${e.Ninos} niño(s)` : ''}<br>
                    <b>Entrada:</b> ${esc(e.EntradaFmt)}<br>
                    <b>${e.EnCasa ? 'Salida programada' : 'Salió'}:</b> ${esc(e.EnCasa ? e.SalidaProgramadaFmt : e.SalidaRealFmt)}
                    ${e.Vencida ? ' <b style="color:#c53030">(vencida)</b>' : ''}<br>
                    <b>Hospedaje:</b> ${money(e.TotalHospedaje)} · <b>Pago:</b> ${esc(e.EstadoPago)}<br>
                    <b>Folio:</b> #${e.RecepcionID}</div>`,
                showCancelButton: true, confirmButtonText: 'Ir a Recepción', cancelButtonText: 'Cerrar'
            }).then(r => { if (r.isConfirmed) App.renderView('recepcion', 'viewport'); });
        } else {
            const r = d.reservas.find(x => `R${x.ReservaID}` === idx);
            if (!r) return;
            let hab = r.HabitacionID ? (d.habitaciones.find(h => h.HabitacionID === r.HabitacionID) || {}).NroHabitacion : null;
            const camaR = r.CamaID ? (d.camas || []).find(c => c.CamaID === r.CamaID) : null;
            if (hab && camaR) hab += ` · Cama ${camaR.Codigo}`;
            Swal.fire({
                title: `Reserva ${esc(r.CodigoReserva || '')}`,
                html: `<div style="text-align:left;line-height:1.8;font-size:.92rem;">
                    <b>Nombre:</b> ${esc(r.NombreReserva)}${r.Telefono ? ` · ${esc(r.Telefono)}` : ''}<br>
                    <b>Tipo:</b> ${esc(r.Tipo)}${hab ? ` · <b>Habitación:</b> ${esc(hab)}` : ' · <i>sin habitación asignada</i>'}<br>
                    <b>Llega:</b> ${esc(r.Llegada)} · <b>Sale:</b> ${esc(r.Salida)}<br>
                    <b>Huéspedes:</b> ${r.Adultos} adulto(s)${r.Ninos ? ` · ${r.Ninos} niño(s)` : ''}<br>
                    <b>Estado:</b> ${esc(r.Estado)} · <b>Canal:</b> ${esc(r.Origen || '—')}<br>
                    <b>Total estimado:</b> ${money(r.TotalEstimado)} · <b>Anticipo:</b> ${money(r.Anticipo)}</div>`,
                showCancelButton: true, confirmButtonText: 'Ir a Reservas', cancelButtonText: 'Cerrar'
            }).then(x => { if (x.isConfirmed) App.renderView('reservas', 'viewport'); });
        }
    }
};

module.exports = PlannerModule;
