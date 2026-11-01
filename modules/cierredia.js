// cierredia.js — Auditoría nocturna (Fase 7): revisar un día terminado, ver sus hallazgos (salidas
// vencidas, cajas abiertas, posibles no-show, comandas abiertas, anulaciones…), cerrarlo con sus
// cifras selladas, reabrirlo con motivo, verificar que nada cambió e imprimir el informe.
// Solo el administrador (/api/indicadores/auditoria/...).
const api = require('./api');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => n == null || !isFinite(n) ? '—' : '$' + Number(n).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = n => n == null || !isFinite(n) ? '—' : `${Number(n).toLocaleString('es-EC', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const errMsg = e => (e && e.response && e.response.data && (e.response.data.error || e.response.data.message)) || (e && e.message) || 'Error';
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const fechaLarga = f => { const [y, m, d] = f.split('-').map(Number); return `${DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`; };
const SEV = { ALTA: ['Grave', 'b-alto'], MEDIA: ['Revisar', 'b-medio'], INFO: ['Informativo', 'b-azul'] };
const CAMPOS = { NochesOcupadas: 'Noches ocupadas', Momentos: 'Momentos', Llegadas: 'Llegadas', Salidas: 'Salidas', NoShows: 'No-show', Cancelaciones: 'Cancelaciones',
    IngresoHab: 'Habitaciones', IngresoMomentos: 'Momentos $', IngresoAyB: 'Alimentos y bebidas', IngresoPar: 'Parqueadero', IngresoEve: 'Eventos',
    IngresoTotal: 'Ingreso total', Cobros: 'Cobrado en caja', Egresos: 'Egresos', Ocupacion: 'Ocupación', ADR: 'ADR', RevPAR: 'RevPAR', TRevPAR: 'TRevPAR' };
const DINERO = new Set(['IngresoHab', 'IngresoMomentos', 'IngresoAyB', 'IngresoPar', 'IngresoEve', 'IngresoTotal', 'Cobros', 'Egresos', 'ADR', 'RevPAR', 'TRevPAR']);
const fmt = (c, v) => c === 'Ocupacion' ? pct(v) : DINERO.has(c) ? money(v) : String(v);
// Columnas legibles de las filas de cada hallazgo (las demás se omiten).
const COLS = {
    SALIDA_VENCIDA: [['NroHabitacion', 'Hab.'], ['Huesped', 'Huésped'], ['Vencio', 'Vencía'], ['TipoAlquiler', 'Tipo']],
    CAJA_ABIERTA: [['CajaID', 'Caja'], ['Usuario', 'Usuario'], ['Apertura', 'Abierta desde']],
    POSIBLE_NO_SHOW: [['CodigoReserva', 'Código'], ['NombreReserva', 'Nombre'], ['Llegada', 'Llegada'], ['Origen', 'Canal']],
    COMANDA_ABIERTA: [['ComandaID', 'Comanda'], ['Mesa', 'Mesa'], ['Apertura', 'Abierta'], ['Total', 'Total']],
    SALIDA_CON_SALDO: [['NroHabitacion', 'Hab.'], ['Huesped', 'Huésped'], ['EstadoPago', 'Estado'], ['Total', 'Total']],
    CAJA_CON_DIFERENCIA: [['CajaID', 'Caja'], ['Usuario', 'Usuario'], ['Diferencia', 'Diferencia']],
    ANULACIONES: [['Hora', 'Hora'], ['NombreUsuario', 'Usuario'], ['Accion', 'Acción'], ['Descripcion', 'Detalle']],
    DESCUENTOS: [['NroHabitacion', 'Hab.'], ['TotalLista', 'Lista'], ['TotalHospedaje', 'Cobrado'], ['Diferencia', 'Diferencia']],
    EVENTO_SIN_REALIZAR: [['Codigo', 'Evento'], ['Nombre', 'Nombre'], ['Fin', 'Terminó'], ['Saldo', 'Saldo']],
};
const MONEDA_COL = new Set(['Total', 'Diferencia', 'TotalLista', 'TotalHospedaje', 'Saldo']);

const CierreDiaModule = {
    dias: [],
    fecha: null,
    datos: null,

    async init() {
        window.CierreDiaModule = this;
        window.backView = 'dashboard';
        document.getElementById('cd-hora').innerHTML = Array.from({ length: 13 }, (_, h) => `<option value="${h}">${h}:00</option>`).join('');
        App.renderSedeSelector('sedeSelectorCierre', () => { this.fecha = null; this.cargarDias(); });
        await this.cargarDias();
    },

    getSedeId() {
        const sel = document.getElementById('globalSedeSelector');
        return sel ? sel.value : (localStorage.getItem('currentSedeId') || App.user.SedeID);
    },

    estadoDia(d) {
        if (!d.Terminado) return '<span class="badge b-gris">En curso</span>';
        if (!d.Cierre) return '<span class="badge b-medio">Sin cerrar</span>';
        if (d.Cierre.Estado === 'REABIERTA') return '<span class="badge b-alto">Reabierto</span>';
        return `<span class="badge b-ok">${d.Cierre.Origen === 'AUTOMATICA' ? 'Cerrado (auto)' : 'Cerrado'}${d.Cierre.Version > 1 ? ` v${d.Cierre.Version}` : ''}</span>`
            + (d.Cierre.HallazgosAltos ? ` <span class="badge b-alto" title="Hallazgos graves al cierre">${d.Cierre.HallazgosAltos}</span>` : '');
    },

    async cargarDias() {
        const cont = document.getElementById('cd-dias');
        try {
            const { data } = await api.get(`/indicadores/auditoria/dias/${this.getSedeId()}`);
            this.dias = data.dias;
            document.getElementById('cd-auto').checked = data.config.AUDITORIA_AUTO === '1';
            document.getElementById('cd-hora').value = String(parseInt(data.config.AUDITORIA_HORA, 10) || 0);
            cont.innerHTML = `<table><thead><tr><th>Día</th><th class="num">Ocup.</th><th class="num">Ingreso</th><th>Estado</th></tr></thead><tbody>
                ${data.dias.map(d => `<tr data-f="${d.Fecha}" class="${d.Fecha === this.fecha ? 'sel' : ''}" onclick="CierreDiaModule.abrir('${d.Fecha}')">
                    <td><b>${fechaLarga(d.Fecha)}</b></td><td class="num">${pct(d.Ocupacion)}</td><td class="num">${money(d.IngresoTotal)}</td><td>${this.estadoDia(d)}</td></tr>`).join('')}
                </tbody></table>`;
            if (!this.fecha) {
                const primero = data.dias.find(d => d.Terminado && (!d.Cierre || d.Cierre.Estado === 'REABIERTA')) || data.dias.find(d => d.Terminado);
                if (primero) this.abrir(primero.Fecha);
            }
        } catch (e) { cont.innerHTML = `<div class="vacio">${esc(errMsg(e))}</div>`; }
    },

    async abrir(fecha) {
        this.fecha = fecha;
        document.querySelectorAll('#cd-dias tr[data-f]').forEach(tr => tr.classList.toggle('sel', tr.dataset.f === fecha));
        const cont = document.getElementById('cd-detalle');
        cont.innerHTML = '<div class="cc-panel"><div class="vacio"><i class="fas fa-spinner fa-spin"></i> Revisando el día…</div></div>';
        try {
            const { data } = await api.get(`/indicadores/auditoria/dia/${this.getSedeId()}/${fecha}`);
            this.datos = data;
            this.pintar();
        } catch (e) { cont.innerHTML = `<div class="cc-panel"><div class="vacio">${esc(errMsg(e))}</div></div>`; }
    },

    tablaFilas(h) {
        const cols = COLS[h.codigo];
        if (!cols || !h.filas.length) return '';
        const marcar = h.codigo === 'POSIBLE_NO_SHOW';
        return `<details ${h.severidad === 'ALTA' || marcar ? 'open' : ''}><summary>Ver ${h.filas.length} registro(s)</summary>
            <table style="margin-top:6px;"><thead><tr>${marcar ? '<th></th>' : ''}${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>
            ${h.filas.map(f => `<tr>${marcar ? `<td><input type="checkbox" data-noshow="${f.ReservaID}" checked></td>` : ''}${cols.map(([k]) => `<td class="${MONEDA_COL.has(k) ? 'num' : ''}">${MONEDA_COL.has(k) ? money(f[k]) : esc(f[k])}</td>`).join('')}</tr>`).join('')}
            </tbody></table>
            ${marcar ? '<div style="margin-top:8px;"><button class="cc-btn mini danger" onclick="CierreDiaModule.marcarNoShow()"><i class="fas fa-user-xmark"></i> Marcar las elegidas como no-show</button></div>' : ''}
            </details>`;
    },

    pintar() {
        const d = this.datos, f = d.foto, v = d.vigente;
        const altos = d.hallazgos.filter(h => h.severidad === 'ALTA').length;
        let sello = '';
        if (v && v.Estado === 'CERRADA') sello = `<div class="sello"><i class="fas fa-lock"></i> <b>Cerrado</b> ${v.Origen === 'AUTOMATICA' ? 'automáticamente' : `por ${esc(v.NombreUsuario)}`} el ${esc(v.FechaCierre)} (versión ${v.Version}).
            ${v.Observacion ? `<br><i>“${esc(v.Observacion)}”</i>` : ''}<br><span class="muted">Las cifras de abajo son las de hoy; use "Verificar" para compararlas con las selladas.</span></div>`;
        else if (v) sello = `<div class="sello reab"><i class="fas fa-lock-open"></i> <b>Reabierto</b> por ${esc(v.ReabiertaPor)} el ${esc(v.FechaReapertura)}: “${esc(v.MotivoReapertura)}”. Corrija y vuelva a cerrarlo.</div>`;
        const kpis = [['Ocupación', pct(f.Ocupacion)], ['Noches', f.NochesOcupadas], ['Momentos', f.Momentos], ['Llegadas / salidas', `${f.Llegadas} / ${f.Salidas}`],
            ['ADR', money(f.ADR)], ['RevPAR', money(f.RevPAR)], ['Habitaciones', money(f.IngresoHab + f.IngresoMomentos)], ['A&B', money(f.IngresoAyB)],
            ['Eventos', money(f.IngresoEve)], ['Parqueadero', money(f.IngresoPar)], ['Ingreso total', money(f.IngresoTotal)], ['Cobrado en caja', money(f.Cobros)],
            ['Egresos', money(f.Egresos)], ['No-show / cancel.', `${f.NoShows} / ${f.Cancelaciones}`], ['Fuera de servicio', `${f.HabFueraServicio} de ${f.HabDisponibles}`]];
        const cerrado = v && v.Estado === 'CERRADA';
        const acciones = !d.cerrable ? '<span class="muted">El día todavía no termina: se cierra mañana.</span>'
            : cerrado ? `<button class="cc-btn" onclick="CierreDiaModule.verificar()"><i class="fas fa-fingerprint"></i> Verificar</button>
                         <button class="cc-btn" onclick="CierreDiaModule.historial()"><i class="fas fa-clock-rotate-left"></i> Historial</button>
                         <button class="cc-btn" onclick="CierreDiaModule.imprimir()"><i class="fas fa-print"></i> Imprimir</button>
                         <button class="cc-btn danger" onclick="CierreDiaModule.reabrir()"><i class="fas fa-lock-open"></i> Reabrir</button>`
            : `<button class="cc-btn ok" onclick="CierreDiaModule.cerrar()"><i class="fas fa-lock"></i> Cerrar el día</button>
               <button class="cc-btn" onclick="CierreDiaModule.imprimir()"><i class="fas fa-print"></i> Imprimir</button>
               ${v ? '<button class="cc-btn" onclick="CierreDiaModule.historial()"><i class="fas fa-clock-rotate-left"></i> Historial</button>' : ''}`;
        document.getElementById('cd-detalle').innerHTML = `
            <div class="cc-panel">
                <h3><i class="fas fa-calendar-day"></i> ${fechaLarga(d.fecha)}</h3>
                <p class="ayuda">Valores de venta del día (como los ve el cajero). Las estadías largas aportan su valor noche por noche.</p>
                ${sello}
                <div class="kpis">${kpis.map(([t, x]) => `<div class="kpi"><div class="t">${t}</div><div class="v">${x}</div></div>`).join('')}</div>
                <div class="acciones">${acciones}</div>
            </div>
            <div class="cc-panel">
                <h3><i class="fas fa-magnifying-glass"></i> Hallazgos ${d.hallazgos.length ? `<span class="badge ${altos ? 'b-alto' : 'b-medio'}">${d.hallazgos.length}</span>` : ''}</h3>
                <p class="ayuda">Lo que un auditor nocturno revisa antes de cerrar. Los graves piden una observación al cerrar.</p>
                ${d.hallazgos.length ? d.hallazgos.map(h => `<div class="hall ${h.severidad}">
                    <div class="tt"><span class="badge ${SEV[h.severidad][1]}">${SEV[h.severidad][0]}</span> ${esc(h.titulo)}</div>
                    <div class="muted" style="margin-top:3px;">${esc(h.detalle)}</div>${this.tablaFilas(h)}</div>`).join('')
                    : '<div class="vacio" style="color:#1e8449;"><i class="fas fa-circle-check"></i> Sin hallazgos: todo en orden.</div>'}
            </div>`;
    },

    async cerrar() {
        const d = this.datos;
        const altos = d.hallazgos.filter(h => h.severidad === 'ALTA');
        const { value: obs, isConfirmed } = await Swal.fire({
            title: `Cerrar el ${fechaLarga(d.fecha)}`,
            html: `<p style="font-size:.85rem;">Se guardan las cifras del día con su huella. ${altos.length ? `<b style="color:#b03a2e;">Hay ${altos.length} hallazgo(s) grave(s):</b> explique cómo se resolverán.` : 'Puede dejar una observación.'}</p>`,
            input: 'textarea', inputPlaceholder: altos.length ? 'Obligatorio (mínimo 10 caracteres)' : 'Opcional',
            showCancelButton: true, confirmButtonText: 'Cerrar el día', cancelButtonText: 'Volver', confirmButtonColor: '#27ae60',
            inputValidator: v => altos.length && String(v || '').trim().length < 10 ? 'Escriba al menos 10 caracteres.' : undefined,
        });
        if (!isConfirmed) return;
        try {
            const { data } = await api.post('/indicadores/auditoria/cerrar', { SedeID: this.getSedeId(), fecha: d.fecha, observacion: obs || '' });
            Swal.fire({ icon: 'success', title: 'Día cerrado', text: `Versión ${data.version}: ocupación ${pct(data.foto.Ocupacion)}, ingreso ${money(data.foto.IngresoTotal)}.`, confirmButtonColor: '#1a365d' });
            await this.cargarDias(); this.abrir(d.fecha);
        } catch (e) { Swal.fire({ icon: 'error', title: 'No se cerró', text: errMsg(e), confirmButtonColor: '#1a365d' }); }
    },

    async reabrir() {
        const { value: motivo, isConfirmed } = await Swal.fire({
            title: 'Reabrir el día', text: 'La versión cerrada queda guardada en el historial. Escriba el motivo.',
            input: 'textarea', showCancelButton: true, confirmButtonText: 'Reabrir', cancelButtonText: 'Volver', confirmButtonColor: '#e74c3c',
            inputValidator: v => String(v || '').trim().length < 10 ? 'Escriba al menos 10 caracteres.' : undefined,
        });
        if (!isConfirmed) return;
        try {
            await api.post('/indicadores/auditoria/reabrir', { SedeID: this.getSedeId(), fecha: this.fecha, motivo });
            await this.cargarDias(); this.abrir(this.fecha);
        } catch (e) { Swal.fire({ icon: 'error', title: 'No se reabrió', text: errMsg(e), confirmButtonColor: '#1a365d' }); }
    },

    async verificar() {
        try {
            const { data } = await api.get(`/indicadores/auditoria/verificar/${this.getSedeId()}/${this.fecha}`);
            const integ = data.integra ? '<p style="color:#1e8449;font-weight:800;"><i class="fas fa-fingerprint"></i> La huella coincide: nadie tocó las cifras selladas.</p>'
                : '<p style="color:#b03a2e;font-weight:800;"><i class="fas fa-triangle-exclamation"></i> La huella NO coincide: las cifras selladas fueron modificadas fuera del sistema.</p>';
            const cambios = data.cambios.length ? `<p style="font-size:.85rem;">Después del cierre cambiaron estas cifras del día:</p>
                <table style="width:100%;font-size:.8rem;border-collapse:collapse;"><tr><th style="text-align:left;">Cifra</th><th style="text-align:right;">Al cierre</th><th style="text-align:right;">Ahora</th><th style="text-align:right;">Diferencia</th></tr>
                ${data.cambios.map(c => `<tr><td>${CAMPOS[c.campo] || c.campo}</td><td style="text-align:right;">${fmt(c.campo, c.alCierre)}</td><td style="text-align:right;">${fmt(c.campo, c.ahora)}</td>
                    <td style="text-align:right;color:#b03a2e;font-weight:800;">${c.diferencia > 0 ? '+' : ''}${fmt(c.campo, c.diferencia)}</td></tr>`).join('')}</table>
                <p style="font-size:.75rem;color:#7f8c8d;">Revise la bitácora (Auditoría) de ese día. Si el cambio es correcto, reabra el día y vuelva a cerrarlo.</p>`
                : '<p style="font-size:.85rem;">Las cifras de hoy son iguales a las del cierre.</p>';
            Swal.fire({ title: `Verificación — versión ${data.version}`, html: integ + cambios, width: 640, confirmButtonColor: '#1a365d', icon: data.integra && !data.cambios.length ? 'success' : 'warning' });
        } catch (e) { Swal.fire({ icon: 'error', title: 'Error', text: errMsg(e), confirmButtonColor: '#1a365d' }); }
    },

    async historial() {
        try {
            const { data } = await api.get(`/indicadores/auditoria/historial/${this.getSedeId()}/${this.fecha}`);
            Swal.fire({ title: 'Historial del cierre', width: 760, confirmButtonColor: '#1a365d', html: `<table style="width:100%;font-size:.78rem;border-collapse:collapse;text-align:left;">
                <tr><th>Versión</th><th>Cerrado</th><th>Ocup.</th><th>Ingreso</th><th>Hallazgos</th><th>Estado</th></tr>
                ${data.map(x => `<tr style="border-top:1px solid #ddd;vertical-align:top;"><td>${x.Version}${x.Vigente ? ' (vigente)' : ''}</td>
                    <td>${esc(x.FechaCierre)}<br><small>${x.Origen === 'AUTOMATICA' ? 'Automático' : esc(x.NombreUsuario)}</small>${x.Observacion ? `<br><small><i>“${esc(x.Observacion)}”</i></small>` : ''}</td>
                    <td>${pct(x.Ocupacion)}</td><td>${money(x.IngresoTotal)}</td><td>${x.Hallazgos}${x.HallazgosAltos ? ` (${x.HallazgosAltos} graves)` : ''}</td>
                    <td>${x.Estado === 'REABIERTA' ? `Reabierto ${esc(x.FechaReapertura)} por ${esc(x.ReabiertaPor)}<br><small>“${esc(x.MotivoReapertura)}”</small>` : 'Cerrado'}</td></tr>`).join('')}</table>` });
        } catch (e) { Swal.fire({ icon: 'error', title: 'Error', text: errMsg(e), confirmButtonColor: '#1a365d' }); }
    },

    async marcarNoShow() {
        const ids = [...document.querySelectorAll('#cd-detalle input[data-noshow]:checked')].map(i => parseInt(i.dataset.noshow, 10));
        if (!ids.length) return;
        const ok = await Swal.fire({ title: `¿Marcar ${ids.length} reserva(s) como no-show?`, text: 'El cupo queda libre. Queda registrado en la bitácora.', icon: 'question',
            showCancelButton: true, confirmButtonText: 'Sí, marcar', cancelButtonText: 'Volver', confirmButtonColor: '#e74c3c' });
        if (!ok.isConfirmed) return;
        try {
            const { data } = await api.post('/indicadores/auditoria/noshow', { SedeID: this.getSedeId(), reservaIds: ids });
            Swal.fire({ icon: 'success', title: `${data.marcadas} marcada(s)`, toast: true, position: 'top-end', timer: 2200, showConfirmButton: false });
            this.abrir(this.fecha);
        } catch (e) { Swal.fire({ icon: 'error', title: 'Error', text: errMsg(e), confirmButtonColor: '#1a365d' }); }
    },

    async guardarConfig() {
        try {
            await api.put('/indicadores/auditoria/config', { SedeID: this.getSedeId(), AUDITORIA_AUTO: document.getElementById('cd-auto').checked ? '1' : '0',
                AUDITORIA_HORA: parseInt(document.getElementById('cd-hora').value, 10) });
            Swal.fire({ icon: 'success', title: 'Guardado', toast: true, position: 'top-end', timer: 1800, showConfirmButton: false });
        } catch (e) { Swal.fire({ icon: 'error', title: 'No se guardó', text: errMsg(e), confirmButtonColor: '#1a365d' }); }
    },

    imprimir() {
        const d = this.datos, f = d.foto, v = d.vigente;
        const hotel = (window.App && App.sedeNombre && App.sedeNombre()) || 'Hotel';
        const filas = Object.entries(CAMPOS).map(([c, t]) => `<tr><td>${t}</td><td style="text-align:right;">${fmt(c, f[c])}</td></tr>`).join('');
        const hall = d.hallazgos.map(h => `<li><b>[${SEV[h.severidad][0]}]</b> ${esc(h.titulo)} — ${esc(h.detalle)}</li>`).join('') || '<li>Sin hallazgos.</li>';
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Cierre ${d.fecha}</title>
            <style>body{font-family:Segoe UI,Arial,sans-serif;font-size:12px;color:#222;margin:28px;} h1{font-size:18px;margin:0;color:#1a365d;} h2{font-size:13px;color:#1a365d;margin:18px 0 6px;}
            table{border-collapse:collapse;width:100%;} td{border-bottom:1px solid #ddd;padding:4px 6px;} .sello{border:1px solid #1a365d;padding:8px;margin-top:10px;}</style></head>
            <body><h1>${esc(hotel)} — Cierre del día</h1><div>${fechaLarga(d.fecha)} · impreso ${new Date().toLocaleString('es-EC')}</div>
            ${v ? `<div class="sello">${v.Estado === 'CERRADA' ? 'CERRADO' : 'REABIERTO'} · versión ${v.Version} · ${esc(v.FechaCierre)} · ${v.Origen === 'AUTOMATICA' ? 'automático' : esc(v.NombreUsuario)}
                ${v.Observacion ? `<br>Observación: ${esc(v.Observacion)}` : ''}<br><small>Huella: ${esc(v.Huella)}</small></div>` : '<div class="sello">SIN CERRAR (cifras al momento de imprimir)</div>'}
            <h2>Cifras del día</h2><table>${filas}</table><h2>Hallazgos</h2><ul>${hall}</ul>
            <p style="margin-top:40px;">______________________________<br>Firma del auditor</p></body></html>`;
        const w = window.open('', '_blank', 'width=820,height=900');
        if (!w) return;
        w.document.write(html); w.document.close(); w.focus();
        setTimeout(() => { try { w.print(); } catch (_) { /* */ } }, 300);
    },
};

module.exports = CierreDiaModule;
