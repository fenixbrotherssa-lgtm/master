// modules/finanzas-movil.js — Finanzas en el celular para el administrador (2.4.1)
// SOLO LECTURA. Usa el mismo endpoint que Finanzas del escritorio:
//   POST /api/reportes/dashboard { sedeId (0 = todas), fechaInicio, fechaFin }
//   → kpis (producción, recaudado, egresos, cartera, neto), métodos, arqueos (turnos) y movimientos.
// Las fechas llegan de SQL sin zona: se leen a mano (nunca new Date(texto ISO): corre 5 h).
const api = require('./api');

const PASO = 60;   // movimientos por tanda en la lista

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
// "2026-11-19T14:05:00.000Z" (hora local del servidor guardada sin zona) → partes sin conversión
function partes(f) {
    const p = String(f || '').replace('Z', '').replace(/\+.*$/, '').replace('T', ' ').split(/[- :.]/);
    return { y: +p[0], m: +p[1], d: +p[2], h: +(p[3] || 0), mi: +(p[4] || 0) };
}
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function hora(f) { const p = partes(f); return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`; }
function diaClave(f) { const p = partes(f); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; }
function diaTexto(clave) {
    const hoy = ymd(new Date());
    const ay = new Date(); ay.setDate(ay.getDate() - 1);
    if (clave === hoy) return 'Hoy';
    if (clave === ymd(ay)) return 'Ayer';
    const [y, m, d] = clave.split('-').map(Number);
    const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    return `${dias[new Date(y, m - 1, d).getDay()]} ${d} ${MESES[m - 1]}`;
}

const FinanzasMovilModule = {
    datos: null,
    periodo: 'hoy',
    filtroTipo: 'TODOS',
    texto: '',
    mostrados: PASO,

    async init() {
        window.FinanzasMovilModule = this;
        const u = this.usuario();
        if (!u || parseInt(u.RolID || u.rol) !== 1) {
            document.getElementById('viewport-mobile').innerHTML =
                '<div style="padding:40px 24px; text-align:center; color:#64748b; font-weight:600;"><i class="fas fa-lock" style="font-size:2rem; margin-bottom:10px;"></i><br>Solo el administrador ve las finanzas.</div>';
            return;
        }
        await this.cargarSedes();
        this.listeners();
        this.fijarPeriodo('hoy');
        await this.cargar();
    },

    usuario() { try { return JSON.parse(localStorage.getItem('user')); } catch (_) { return null; } },
    money(n) { return '$' + (parseFloat(n) || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    set(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; },

    async cargarSedes() {
        const sel = document.getElementById('fz-sede');
        if (!sel) return;
        try {
            const r = await api.get('/admin/sedes');
            const sedes = (r.data || []).filter(s => s.Estado === undefined || s.Estado === true || s.Estado === 1);
            const actual = String(localStorage.getItem('currentSedeId') || (this.usuario() || {}).SedeID || '');
            sel.innerHTML = (sedes.length > 1 ? '<option value="0">Todas las sedes</option>' : '') +
                sedes.map(s => `<option value="${s.SedeID}" ${String(s.SedeID) === actual ? 'selected' : ''}>${esc(s.NombreComercial || 'Sede ' + s.SedeID)}</option>`).join('');
            if (sedes.length <= 1) sel.style.display = 'none';
        } catch (_) { sel.style.display = 'none'; }
    },

    sedeId() {
        const sel = document.getElementById('fz-sede');
        if (sel && sel.style.display !== 'none' && sel.value !== '') return parseInt(sel.value) || 0;
        const u = this.usuario() || {};
        return parseInt(localStorage.getItem('currentSedeId') || u.SedeID) || 0;
    },

    listeners() {
        document.querySelectorAll('#fz-chips .fz-chip').forEach(b => b.onclick = () => {
            this.fijarPeriodo(b.dataset.periodo);
            if (b.dataset.periodo !== 'rango') this.cargar();
        });
        const d = document.getElementById('fz-desde'), h = document.getElementById('fz-hasta');
        if (d) d.onchange = () => this.cargar();
        if (h) h.onchange = () => this.cargar();
        const sel = document.getElementById('fz-sede');
        if (sel) sel.onchange = () => this.cargar();
        document.querySelectorAll('#fz-seg button').forEach(b => b.onclick = () => {
            document.querySelectorAll('#fz-seg button').forEach(x => x.classList.toggle('on', x === b));
            this.filtroTipo = b.dataset.tipo; this.mostrados = PASO; this.pintarLista();
        });
        const q = document.getElementById('fz-buscar');
        if (q) q.oninput = () => { this.texto = q.value.trim().toLowerCase(); this.mostrados = PASO; this.pintarLista(); };
    },

    fijarPeriodo(p) {
        this.periodo = p;
        document.querySelectorAll('#fz-chips .fz-chip').forEach(b => b.classList.toggle('on', b.dataset.periodo === p));
        const rango = document.getElementById('fz-rango');
        if (rango) rango.classList.toggle('on', p === 'rango');
        const hoy = new Date();
        let desde = new Date(hoy), hasta = new Date(hoy);
        if (p === 'ayer') { desde.setDate(hoy.getDate() - 1); hasta = new Date(desde); }
        else if (p === '7d') { desde.setDate(hoy.getDate() - 6); }
        else if (p === 'mes') { desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1); }
        else if (p === 'mesant') { desde = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1); hasta = new Date(hoy.getFullYear(), hoy.getMonth(), 0); }
        const d = document.getElementById('fz-desde'), h = document.getElementById('fz-hasta');
        if (p !== 'rango' || !d.value) { d.value = ymd(desde); h.value = ymd(hasta); }
    },

    async cargar() {
        const fechaInicio = document.getElementById('fz-desde').value;
        const fechaFin = document.getElementById('fz-hasta').value;
        if (fechaInicio && fechaFin && fechaInicio > fechaFin) return window.Toast && Toast.fire({ icon: 'warning', title: 'La fecha inicial es mayor que la final' });
        const lista = document.getElementById('fz-lista');
        if (lista) lista.innerHTML = '<div class="fz-skel"></div><div class="fz-skel"></div><div class="fz-skel"></div>';
        try {
            const r = await api.post('/reportes/dashboard', { sedeId: this.sedeId(), fechaInicio, fechaFin });
            this.datos = r.data || {};
            this.mostrados = PASO;
            this.pintar(fechaInicio, fechaFin);
        } catch (e) {
            if (lista) lista.innerHTML = `<div class="fz-vacio"><i class="fas fa-triangle-exclamation"></i> No se pudo cargar: ${esc((e.response && e.response.data && e.response.data.error) || e.message)}</div>`;
        }
    },

    pintar(desde, hasta) {
        const k = this.datos.kpis || {};
        this.set('fz-neto', this.money(k.disponibleNeto));
        this.set('fz-rec', this.money(k.recaudacionReal));
        this.set('fz-egr', this.money(k.egresos));
        this.set('fz-prod', this.money(k.produccionTotal));
        this.set('fz-cart', this.money(k.carteraPendiente));
        const f = s => { const [y, m, d] = s.split('-').map(Number); return `${d} ${MESES[m - 1]} ${y}`; };
        this.set('fz-rango-txt', desde === hasta ? f(desde) : `${f(desde)} — ${f(hasta)}`);
        const sel = document.getElementById('fz-sede');
        this.set('fz-subtitulo', sel && sel.style.display !== 'none' && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : 'Movimientos de caja y administración');

        // Métodos de pago
        const met = (this.datos.metodos || []).slice().sort((a, b) => b.Total - a.Total);
        const totalMet = met.reduce((s, m) => s + (parseFloat(m.Total) || 0), 0);
        this.set('fz-met-total', totalMet ? this.money(totalMet) : '');
        document.getElementById('fz-metodos').innerHTML = met.length ? met.map(m => {
            const pct = totalMet ? Math.round((parseFloat(m.Total) || 0) * 100 / totalMet) : 0;
            return `<div class="fz-met"><div class="t"><span>${esc(m.Nombre)}</span><b>${this.money(m.Total)} · ${pct}%</b></div>
                    <div class="fz-bar"><i style="width:${Math.max(pct, 2)}%"></i></div></div>`;
        }).join('') : '<div class="fz-vacio">Sin ingresos en el período</div>';

        // Turnos
        const tur = this.datos.arqueos || [];
        this.set('fz-turnos-count', tur.length ? `${tur.length}` : '');
        document.getElementById('fz-turnos').innerHTML = tur.length ? tur.map(t => {
            const abierta = t.Estado === true || t.Estado === 1;
            const dif = parseFloat(t.Diferencia || 0);
            const ini = String(t.Cajero || '?').split(' ').filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
            const p = partes(t.FechaApertura);
            const badge = abierta
                ? '<span class="fz-badge" style="background:#ecfdf5; color:#059669;">ABIERTA</span>'
                : `<span class="fz-badge" style="background:${Math.abs(dif) < 0.01 ? '#eef2f7' : dif < 0 ? '#fff1f2' : '#ecfdf5'}; color:${Math.abs(dif) < 0.01 ? '#475569' : dif < 0 ? '#e11d48' : '#059669'};">${Math.abs(dif) < 0.01 ? 'CUADRADA' : (dif < 0 ? 'FALTA ' : 'SOBRA ') + this.money(Math.abs(dif))}</span>`;
            return `<div class="fz-turno"><div class="av">${esc(ini)}</div>
                    <div class="tx"><b>${esc(t.Cajero)}</b><small>Turno #${t.CajaID} · ${p.d} ${MESES[p.m - 1] || ''} ${hora(t.FechaApertura)}${!abierta && t.MontoCierre != null ? ' · declaró ' + this.money(t.MontoCierre) : ''}</small></div>
                    ${badge}</div>`;
        }).join('') : '<div class="fz-vacio">Sin turnos en el período</div>';

        this.pintarLista();
    },

    filtrados() {
        const movs = this.datos && this.datos.auditoria || [];
        return movs.filter(m => {
            const ing = m.TipoMovimiento === 'Ingreso';
            if (this.filtroTipo === 'Ingreso' && !ing) return false;
            if (this.filtroTipo === 'Egreso' && ing) return false;
            if (!this.texto) return true;
            return [m.RubroNombre, m.Metodo, m.Observacion, m.Responsable, m.CentroNombre, m.ReferenciaVoucher]
                .some(x => x && String(x).toLowerCase().includes(this.texto));
        });
    },

    pintarLista() {
        const cont = document.getElementById('fz-lista');
        if (!cont || !this.datos) return;
        const lista = this.filtrados();
        const tIn = lista.filter(m => m.TipoMovimiento === 'Ingreso').reduce((s, m) => s + (parseFloat(m.Monto) || 0), 0);
        const tOut = lista.filter(m => m.TipoMovimiento !== 'Ingreso').reduce((s, m) => s + (parseFloat(m.Monto) || 0), 0);
        this.set('fz-mov-count', lista.length ? `${lista.length} · +${this.money(tIn)} / −${this.money(tOut)}` : '');
        if (!lista.length) { cont.innerHTML = '<div class="fz-vacio"><i class="fas fa-receipt" style="font-size:1.6rem; display:block; margin-bottom:8px;"></i>Sin movimientos</div>'; return; }

        const vis = lista.slice(0, this.mostrados);
        let html = '', dia = null;
        const idx = new Map(lista.map((m, i) => [m, i]));
        for (const m of vis) {
            const dc = diaClave(m.FechaMovimiento);
            if (dc !== dia) {
                dia = dc;
                const delDia = lista.filter(x => diaClave(x.FechaMovimiento) === dc);
                const neto = delDia.reduce((s, x) => s + (x.TipoMovimiento === 'Ingreso' ? 1 : -1) * (parseFloat(x.Monto) || 0), 0);
                html += `<div class="fz-dia"><span>${esc(diaTexto(dc))}</span><span style="color:${neto < 0 ? '#e11d48' : '#059669'}">${neto < 0 ? '−' : '+'}${this.money(Math.abs(neto))}</span></div>`;
            }
            const ing = m.TipoMovimiento === 'Ingreso';
            const titulo = m.RubroNombre || this.conceptoCorto(m.Observacion) || (ing ? 'Ingreso' : 'Egreso');
            html += `<div class="fz-mov" onclick="FinanzasMovilModule.detalle(${idx.get(m)})">
                <div class="ic ${ing ? 'in' : 'out'}"><i class="fas ${this.icono(m, ing)}"></i></div>
                <div class="tx"><b>${esc(titulo)}</b><small>${esc(m.Responsable || 'Administración')} · ${esc(m.Metodo || '')}${m.ImagenVoucherPath ? ' · <i class="fas fa-paperclip"></i>' : ''}</small></div>
                <div class="mt ${ing ? 'in' : 'out'}">${ing ? '+' : '−'}${this.money(m.Monto)}<small>${hora(m.FechaMovimiento)}</small></div>
            </div>`;
        }
        if (lista.length > this.mostrados) html += `<button class="fz-mas" onclick="FinanzasMovilModule.verMas()">Ver ${Math.min(PASO, lista.length - this.mostrados)} más (${lista.length - this.mostrados} restantes)</button>`;
        cont.innerHTML = html;
    },

    verMas() { this.mostrados += PASO; this.pintarLista(); },

    conceptoCorto(obs) {
        if (!obs) return '';
        const s = String(obs).replace(/^\[ADMIN\]\s*/, '');
        return s.split('|')[0].trim().slice(0, 48);
    },

    icono(m, ing) {
        const o = String(m.Observacion || '').toUpperCase();
        if (o.includes('CHECK-IN') || o.includes('FOLIO') || o.includes('HOSPEDAJE')) return 'fa-bed';
        if (o.includes('RESTAURANTE') || o.includes('COMANDA') || o.includes('MESA')) return 'fa-utensils';
        if (o.includes('PARQUE')) return 'fa-car';
        if (o.includes('ANTICIPO')) return 'fa-hand-holding-dollar';
        if (o.includes('ADELANTO') || o.includes('NOMINA') || o.includes('SUELDO')) return 'fa-user-tie';
        if (o.includes('POS') || o.includes('VENTA') || o.includes('TIENDA')) return 'fa-bag-shopping';
        if (o.includes('COMPRA')) return 'fa-truck';
        return ing ? 'fa-arrow-down' : 'fa-arrow-up';
    },

    detalle(i) {
        const m = this.filtrados()[i];
        if (!m) return;
        const ing = m.TipoMovimiento === 'Ingreso';
        const p = partes(m.FechaMovimiento);
        const base = (window.AppConfig && window.AppConfig.baseUrl) || '';
        const fila = (k, v) => v ? `<div style="display:flex; justify-content:space-between; gap:12px; padding:9px 0; border-bottom:1px solid #f1f5f9; text-align:left;">
                <span style="color:#64748b; font-size:.8rem; font-weight:600; flex:0 0 auto;">${k}</span>
                <span style="color:#0f172a; font-size:.85rem; font-weight:700; text-align:right; word-break:break-word;">${v}</span></div>` : '';
        Swal.fire({
            showConfirmButton: false, showCloseButton: true, position: 'bottom', width: '100%',
            customClass: { popup: 'mh-sheet' },
            html: `
                <div style="text-align:center; margin-bottom:12px;">
                    <div style="width:56px; height:56px; margin:0 auto 10px; border-radius:18px; display:flex; align-items:center; justify-content:center; font-size:1.4rem;
                                background:${ing ? '#ecfdf5' : '#fff1f2'}; color:${ing ? '#059669' : '#e11d48'};"><i class="fas ${this.icono(m, ing)}"></i></div>
                    <div style="font-size:1.9rem; font-weight:800; color:${ing ? '#059669' : '#e11d48'}; letter-spacing:-.02em;">${ing ? '+' : '−'}${this.money(m.Monto)}</div>
                    <div style="font-size:.8rem; color:#64748b; font-weight:700; margin-top:2px;">${ing ? 'INGRESO' : esc(String(m.TipoMovimiento || 'EGRESO').toUpperCase())} · #${m.MovimientoID}</div>
                </div>
                ${fila('Fecha', `${p.d} ${MESES[p.m - 1] || ''} ${p.y} · ${hora(m.FechaMovimiento)}`)}
                ${fila('Rubro', esc(m.RubroNombre))}
                ${fila('Método', esc(m.Metodo))}
                ${fila('Responsable', esc(m.Responsable))}
                ${fila('Centro de costo', m.CentroCodigo ? esc(`${m.CentroCodigo} · ${m.CentroNombre || ''}`) : '')}
                ${fila('Referencia', esc(m.ReferenciaVoucher))}
                ${fila('Cierre', m.CierreMaestroID ? `<i class="fas fa-lock"></i> Cierre maestro #${m.CierreMaestroID}` : '')}
                ${m.Observacion ? `<div style="text-align:left; margin-top:10px; background:#f8fafc; border-radius:12px; padding:12px; font-size:.84rem; color:#334155; line-height:1.45;">${esc(m.Observacion)}</div>` : ''}
                ${m.ImagenVoucherPath ? `<a href="${esc(base)}/uploads/${esc(m.ImagenVoucherPath)}" target="_blank" style="display:block; margin-top:12px;">
                    <img src="${esc(base)}/uploads/${esc(m.ImagenVoucherPath)}" alt="Comprobante" style="width:100%; max-height:340px; object-fit:contain; border-radius:14px; background:#f1f5f9;"
                         onerror="this.replaceWith(Object.assign(document.createElement('div'),{textContent:'Comprobante adjunto (toque para abrir)',style:'padding:14px;border-radius:12px;background:#eef2f7;color:#1a365d;font-weight:700;'}))"></a>` : ''}
                <p style="font-size:.72rem; color:#94a3b8; margin:14px 0 0;">Solo consulta. Para anular o corregir, use Finanzas en el escritorio.</p>`
        });
    }
};

module.exports = FinanzasMovilModule;
