// recepcion-movil.js — Recepción en el celular del propietario (2.4.0): habitaciones, llegadas de hoy y CHECK-IN
// completo con cobro. Usa EXACTAMENTE los mismos endpoints que el escritorio (POST /recepcion/checkin, mismas
// validaciones, misma tarifa de lista y auditoría; el registro queda marcado [MÓVIL]). El cobro entra a la caja
// ABIERTA del usuario en esta sede; sin caja abierta el check-in se puede hacer con pago $0 (queda Pendiente).
const api = require('./api');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = n => '$' + Number(n || 0).toFixed(2);
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const pad = n => String(n).padStart(2, '0');
const clave = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const COLOR = { DISPONIBLE: '#27ae60', OCUPADA: '#c0392b', LIMPIEZA: '#3498db', MANTENIMIENTO: '#b7950b' };

function usuario() { try { return JSON.parse(localStorage.getItem('user')) || {}; } catch (e) { return {}; } }
function sedeActual() { const u = usuario(); return localStorage.getItem('currentSedeId') || u.SedeID || ''; }
const toast = (icon, title) => (window.Toast ? window.Toast.fire({ icon, title }) : null);
const $ = id => document.getElementById(id);

const RecepcionMovilModule = {
    tab: 'rack',
    rack: [],
    reservas: [],
    cajaId: null,
    unidad: null,          // habitación (o cama) elegida para el check-in
    tarifa: null,          // /tarifas/habitacion/:id
    desayuno: null,        // /desayunos/habitacion/:id
    reserva: null,         // si el check-in nace de una reserva
    consent: {},           // casillas de promociones que se tocaron

    async init() {
        window.RecepcionMovilModule = this;
        if (window.socket) {
            window.socket.off('habitacion:cambio');
            window.socket.on('habitacion:cambio', () => { if (!this.unidad) this.cargar(); });
        }
        await this.cargar();
    },

    async cargar() {
        const u = usuario(), s = sedeActual();
        try {
            const [rack, caja, resv] = await Promise.all([
                api.get(`/recepcion/rack/${s}`),
                api.get(`/caja/estado/${u.UsuarioID}/${s}`).catch(() => ({ data: {} })),
                api.get(`/reservas/lista/${s}`).catch(() => ({ data: [] })),
            ]);
            this.rack = rack.data || [];
            this.cajaId = caja.data && caja.data.abierta ? caja.data.caja.CajaID : null;
            const hoy = clave(new Date()), manana = clave(new Date(Date.now() + 86400000));
            const lista = Array.isArray(resv.data) ? resv.data : (resv.data.reservas || []);
            this.reservas = lista.filter(r => ['PENDIENTE', 'CONFIRMADA'].includes(r.Estado) && !r.RecepcionID &&
                String(r.FechaLlegada || '').slice(0, 10) <= manana)
                .map(r => ({ ...r, _hoy: String(r.FechaLlegada || '').slice(0, 10) <= hoy }));
            this.render();
        } catch (e) {
            const root = $('rm-root');
            if (root) root.innerHTML = `<div class="rm-vacio">${esc(e.response?.data?.error || 'No se pudo cargar recepción')}</div>`;
        }
    },

    // Unidades vendibles: habitaciones normales + cada cama de un dormitorio
    unidades() {
        const out = [], vistos = new Set();
        for (const h of this.rack) {
            if (!h.EsDormitorio) { out.push({ ...h, _clave: String(h.HabitacionID) }); continue; }
            if (vistos.has(h.HabitacionID)) continue;
            vistos.add(h.HabitacionID);
            for (const c of (h.Camas || [])) {
                out.push({ ...h, Estado: h.Estado === 'MANTENIMIENTO' ? 'MANTENIMIENTO' : c.Estado, CamaID: c.CamaID, CamaCodigo: c.Codigo,
                    NroHabitacion: `${h.NroHabitacionBase} · Cama ${c.Codigo}`, PrecioDia: Number(c.PrecioDia || h.PrecioDia || 0),
                    PrecioPeriodo: Number(c.PrecioPeriodo || h.PrecioPeriodo || 0), RecepcionID: c.RecepcionID || null,
                    Huesped: c.Huesped || null, FechaSalidaFmt: c.FechaSalidaFmt || null, _clave: `${h.HabitacionID}|${c.CamaID}` });
            }
        }
        return out;
    },

    cambiarTab(t) { this.tab = t; this.render(); },

    render() {
        const root = $('rm-root');
        if (!root) return;
        const us = this.unidades();
        const cuenta = e => us.filter(u => u.Estado === e).length;
        const cajaTxt = this.cajaId
            ? `<span style="color:#2f855a">● Caja abierta #${this.cajaId}</span>`
            : `<span style="color:#c05621">● Caja cerrada: el check-in se registra sin cobro</span> <a href="#" onclick="AppMobile.renderView('caja-movil');return false;">abrir caja</a>`;
        const tabs = `<div class="rm-tabs">
            <button class="${this.tab === 'rack' ? 'on' : ''}" onclick="RecepcionMovilModule.cambiarTab('rack')">HABITACIONES</button>
            <button class="${this.tab === 'llegadas' ? 'on' : ''}" onclick="RecepcionMovilModule.cambiarTab('llegadas')">LLEGADAS (${this.reservas.length})</button>
        </div>`;
        let cuerpo;
        if (this.tab === 'rack') {
            const pisos = [...new Set(us.map(u => u.Piso))].sort((a, b) => a - b);
            cuerpo = pisos.map(p => `<div class="rm-piso">PISO ${esc(p)}</div><div class="rm-grid">` +
                us.filter(u => u.Piso === p).map(u => `
                    <div class="rm-hab" style="border-top:5px solid ${COLOR[u.Estado] || '#a0aec0'}" onclick="RecepcionMovilModule.tocar('${u._clave}')">
                        <div class="n">${esc(u.NroHabitacion)}</div>
                        <div class="t">${esc(u.Categoria || '')}</div>
                        <div class="e" style="color:${COLOR[u.Estado] || '#4a5568'}">${u.Estado === 'OCUPADA' ? esc((u.Huesped || '').split(' ')[0] || 'OCUPADA') : esc(u.Estado)}</div>
                    </div>`).join('') + '</div>').join('');
        } else {
            cuerpo = this.reservas.length ? this.reservas.map(r => `
                <div class="rm-resv">
                    <div style="min-width:0;">
                        <div style="font-weight:900;color:#1a365d;">${esc(r.NombreReserva)} <small style="color:#718096">${esc(r.CodigoReserva || '')}</small></div>
                        <div style="font-size:.72rem;color:#4a5568;">${esc(r.TipoNombre || '')} · ${esc(r.LlegadaFmt || '')} → ${esc(r.SalidaFmt || '')}${r.HabitacionPineada ? ' · hab. ' + esc(r.HabitacionPineada) : ''}</div>
                        <div style="font-size:.68rem;color:#718096;">${money(r.TotalEstimado)}${Number(r.AnticipoCaja) > 0 ? ` · anticipo ${money(r.AnticipoCaja)}` : ''}${r._hoy ? '' : ' · llega mañana'}${r.EsAtrasada ? ' · <b style="color:#c05621">atrasada</b>' : ''}</div>
                    </div>
                    ${r._hoy ? `<button class="rm-btn" onclick="RecepcionMovilModule.desdeReserva(${r.ReservaID})">CHECK-IN</button>` : ''}
                </div>`).join('') : '<div class="rm-vacio">No hay llegadas pendientes para hoy ni mañana.</div>';
        }
        root.innerHTML = `
            <div class="rm-resumen">
                <span style="color:#27ae60">${cuenta('DISPONIBLE')} libres</span> · <span style="color:#c0392b">${cuenta('OCUPADA')} ocupadas</span> ·
                <span style="color:#3498db">${cuenta('LIMPIEZA')} limpieza</span>
            </div>
            <div class="rm-caja">${cajaTxt}</div>
            ${tabs}${cuerpo}`;
    },

    tocar(k) {
        const u = this.unidades().find(x => x._clave === k);
        if (!u) return;
        if (u.Estado === 'DISPONIBLE') return this.abrirCheckIn(u);
        if (u.Estado === 'OCUPADA' && u.RecepcionID) return this.verFolio(u);
        Swal.fire({ icon: 'info', title: `Hab. ${u.NroHabitacion}`, text: u.Estado === 'LIMPIEZA'
            ? 'La habitación está en LIMPIEZA. Márquela lista desde Limpieza antes de asignarla.' : `Estado: ${u.Estado}` });
    },

    async verFolio(u) {
        try {
            const { data } = await api.get(`/recepcion/folio/${u.RecepcionID}`);
            const r = data.recepcion || {};
            const cons = (data.consumos || []).filter(c => !c.EsCortesia).reduce((a, c) => a + Number(c.Subtotal || 0), 0);
            Swal.fire({
                title: `Hab. ${esc(u.NroHabitacion)}`,
                html: `<div style="text-align:left;font-size:.85rem;line-height:1.6;">
                    <b>${esc(r.NombreFull)}</b> · ${esc(r.Documento || '')}<br>
                    Entrada: ${esc(r.FechaEntradaFmt || '')}<br>Salida: ${esc(r.FechaSalidaProgramadaFmt || '')}<br>
                    ${esc(r.TipoAlquiler || '')} · ${r.NroAdultos || 1} adulto(s)${r.NroNiños ? ` + ${r.NroNiños} niño(s)` : ''}<br>
                    Hospedaje: ${money(r.TotalHospedaje)} · Consumos: ${money(cons)}<br>
                    <b style="font-size:1rem;color:${Number(data.saldo) > 0.01 ? '#c05621' : '#2f855a'}">Saldo: ${money(data.saldo)}</b></div>
                    <div style="font-size:.7rem;color:#718096;margin-top:8px;">Cobros y salida: en Recepción del escritorio o en CAJA.</div>`,
            });
        } catch (e) { Swal.fire({ icon: 'error', text: e.response?.data?.error || 'No se pudo abrir el folio' }); }
    },

    // ================= CHECK-IN =================
    async abrirCheckIn(u, reserva = null) {
        this.unidad = u; this.reserva = reserva; this.tarifa = null; this.desayuno = null; this.consent = {};
        this.tarifaReserva = null; this._montoTocado = false; this._nacimiento = null;
        const root = $('rm-root');
        const momentoOk = !u.CamaID && Number(u.PrecioMomento) > 0;
        root.innerHTML = `
            <div class="rm-form">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                    <button class="rm-btn gris" onclick="RecepcionMovilModule.cerrarCheckIn()">◀</button>
                    <div style="font-weight:900;color:#1a365d;font-size:1.1rem;">CHECK-IN · ${esc(u.NroHabitacion)}${reserva ? `<br><small style="color:#b7791f">Reserva ${esc(reserva.CodigoReserva || '')}</small>` : ''}</div>
                </div>
                <label>Cédula / pasaporte</label>
                <div style="display:flex;gap:8px;"><input id="rm-doc" inputmode="text" placeholder="Documento" style="flex:1">
                    <button class="rm-btn" onclick="RecepcionMovilModule.buscarCliente()">BUSCAR</button></div>
                <label>Nombre completo</label><input id="rm-nombre" placeholder="Nombre del huésped">
                <label>Teléfono / WhatsApp</label><input id="rm-tel" inputmode="tel" placeholder="Celular (extranjero: +código país)">
                <div id="rm-tel-wa" style="font-size:.68rem;margin:-6px 0 8px;min-height:12px;"></div>
                <label>Procedencia (ciudad / país)</label><input id="rm-proc" placeholder="Ej: Quito, Bogotá - Colombia">
                <label>Correo</label><input id="rm-correo" type="email" placeholder="opcional">
                <div class="rm-check"><label><input type="checkbox" id="rm-acepta-wa" onchange="RecepcionMovilModule.consent.AceptaWhatsApp=this.checked"> Acepta promociones por WhatsApp</label></div>
                <div class="rm-check"><label><input type="checkbox" id="rm-acepta-co" onchange="RecepcionMovilModule.consent.AceptaCorreo=this.checked"> Acepta promociones por correo</label></div>

                <div style="display:flex;gap:8px;">
                    <div style="flex:1"><label>Modalidad</label>
                        <select id="rm-tipo" onchange="RecepcionMovilModule.recalcular()">
                            <option value="Dia">Día (noches)</option>
                            ${momentoOk ? '<option value="Momento">Momento</option>' : ''}
                            ${Number(u.PrecioPeriodo) > 0 ? '<option value="Periodo">Periodo (30 días)</option>' : ''}
                        </select></div>
                    <div style="flex:1"><label id="rm-lbl-tiempo">Noches</label><input id="rm-tiempo" type="number" min="1" value="1" oninput="RecepcionMovilModule.recalcular()"></div>
                </div>
                <div style="display:flex;gap:8px;">
                    <div style="flex:1"><label>Adultos</label><input id="rm-adultos" type="number" min="1" value="1" oninput="RecepcionMovilModule.recalcular()"></div>
                    <div style="flex:1"><label>Niños</label><input id="rm-ninos" type="number" min="0" value="0" oninput="RecepcionMovilModule.recalcular()"></div>
                </div>

                <div id="rm-desayuno" style="display:none;" class="rm-des">
                    <label style="display:flex;gap:10px;align-items:center;font-weight:900;color:#975a16;margin:0;">
                        <input type="checkbox" id="rm-des-tomar" onchange="RecepcionMovilModule.recalcular()"> <span id="rm-des-lbl">☕ DESAYUNO</span></label>
                    <div id="rm-des-box" style="display:flex;gap:8px;align-items:center;margin-top:6px;">
                        <span style="font-size:.72rem;font-weight:800;">Personas</span><input id="rm-des-personas" type="number" min="1" style="width:80px;margin:0;" oninput="RecepcionMovilModule._desTocado=true;RecepcionMovilModule.recalcular()">
                    </div>
                    <div id="rm-des-nota" style="font-size:.68rem;color:#718096;margin-top:4px;"></div>
                </div>

                <label>Descuento ($)</label><input id="rm-desc" type="number" min="0" step="0.01" value="0" oninput="RecepcionMovilModule.recalcular()">
                <div class="rm-total"><small>TOTAL HOSPEDAJE</small><div id="rm-total">$0.00</div><div id="rm-nota" style="font-size:.66rem;opacity:.85;"></div></div>

                <div id="rm-pago">
                    <label>Cobrar ahora ($)</label><input id="rm-monto" type="number" min="0" step="0.01">
                    <label>Método de pago</label>
                    <select id="rm-metodo" data-metodos-pago onchange="RecepcionMovilModule.toggleVoucher()">
                        <option value="1">EFECTIVO</option><option value="2">TRANSFERENCIA</option><option value="3">TARJETA</option>
                    </select>
                    <div id="rm-voucher-box" style="display:none;">
                        <label>Referencia</label><input id="rm-ref" placeholder="N° de comprobante">
                        <label>Foto del comprobante</label><input id="rm-voucher" type="file" accept="image/*,application/pdf" capture="environment">
                    </div>
                </div>
                ${this.cajaId ? '' : '<div style="font-size:.72rem;color:#c05621;font-weight:800;margin:6px 0;">Caja cerrada: se registrará sin cobro (queda pendiente de pago).</div>'}
                <button class="rm-btn grande" id="rm-confirmar" onclick="RecepcionMovilModule.confirmar()">CONFIRMAR INGRESO</button>
            </div>`;
        if (!this.cajaId) $('rm-pago').style.display = 'none';
        if (window.TelefonoWA) TelefonoWA.vincular($('rm-tel'), $('rm-proc'), $('rm-tel-wa'));
        this._desTocado = false;
        if (reserva) this.precargarReserva(reserva);
        this.recalcular();
        try {
            const [t, d] = await Promise.all([
                api.get(`/tarifas/habitacion/${u.HabitacionID}?dias=90`).catch(() => ({ data: null })),
                api.get(`/desayunos/habitacion/${u.HabitacionID}`).catch(() => ({ data: null })),
            ]);
            if (this.unidad !== u) return;
            this.tarifa = t.data;
            this.desayuno = d.data && d.data.habilitado ? d.data : null;
            if (this.desayuno && $('rm-des-tomar')) $('rm-des-tomar').checked = this.desayuno.Modo === 'INCLUIDO';
            this.recalcular();
        } catch (_) { /* sin tarifa dinámica: precio de la ficha */ }
    },

    cerrarCheckIn() { this.unidad = null; this.reserva = null; this.render(); this.cargar(); },

    precargarReserva(rv) {
        $('rm-doc').value = rv.Documento || '';
        $('rm-nombre').value = rv.NombreReserva || '';
        $('rm-tel').value = rv.Telefono || '';
        $('rm-correo').value = rv.Correo || '';
        $('rm-adultos').value = rv.NroAdultos || 1;
        $('rm-ninos').value = rv.NroNinos || 0;
        const ini = String(rv.FechaLlegada || '').slice(0, 10), fin = String(rv.FechaSalida || '').slice(0, 10);
        const [a, b] = [ini, fin].map(t => { const [y, m, d] = t.split('-').map(Number); return Date.UTC(y, m - 1, d); });
        const noches = Math.max(1, Math.round((b - a) / 86400000) || 1);
        $('rm-tiempo').value = noches;
        const antCaja = r2(parseFloat(rv.AnticipoCaja) || 0);
        this.tarifaReserva = { total: parseFloat(rv.TotalEstimado) || 0, noches, codigo: rv.CodigoReserva, anticipo: antCaja };
        if (rv.Documento) this.buscarCliente(true);
    },

    async buscarCliente(silencioso) {
        const doc = ($('rm-doc').value || '').trim();
        if (!doc) return;
        try {
            const { data } = await api.get(`/recepcion/cliente/${encodeURIComponent(doc)}`);
            if (data.success && data.cliente) {
                const c = data.cliente;
                $('rm-nombre').value = c.NombreFull || $('rm-nombre').value;
                $('rm-tel').value = c.Telefono || $('rm-tel').value;
                $('rm-proc').value = c.Procedencia || '';
                $('rm-correo').value = c.Correo || $('rm-correo').value;
                this._nacimiento = c.FechaNacimiento ? String(c.FechaNacimiento).split('T')[0] : null;
                if (c.AceptaWhatsApp === true) $('rm-acepta-wa').checked = true;
                if (c.AceptaCorreo === true) $('rm-acepta-co').checked = true;
                if (window.TelefonoWA) TelefonoWA.refrescar($('rm-tel-wa'));
                if (data.deudaPendiente) Swal.fire({ icon: 'warning', title: 'CLIENTE CON DEUDA', text: `Saldo pendiente de estadías anteriores: ${money(data.montoDeuda)}` });
                else if (!silencioso) toast('success', data.source === 'padron' ? 'Datos del padrón' : 'Cliente encontrado');
            } else if (!silencioso) toast('info', 'Cliente nuevo: complete los datos');
        } catch (e) { if (!silencioso) toast('error', 'No se pudo buscar el documento'); }
    },

    toggleVoucher() {
        const v = $('rm-metodo').value;
        const noEf = window.MetodosPago ? MetodosPago.esNoEfectivo(v) : (v === '2' || v === '3');
        $('rm-voucher-box').style.display = noEf ? 'block' : 'none';
    },

    // Mismo cálculo que el escritorio (recepcion.js): tarifa del día noche por noche; el servidor recalcula la lista
    // y deja la diferencia como descuento trazado.
    recalcular() {
        const u = this.unidad; if (!u || !$('rm-tipo')) return;
        const tipo = $('rm-tipo').value, tiempo = Math.max(1, parseInt($('rm-tiempo').value) || 1);
        const desc = parseFloat($('rm-desc').value) || 0;
        $('rm-lbl-tiempo').textContent = tipo === 'Dia' ? 'Noches' : tipo === 'Momento' ? 'Momentos' : 'Meses';
        let precio = tipo === 'Momento' ? Number(u.PrecioMomento) : tipo === 'Periodo' ? Number(u.PrecioPeriodo) : Number(u.PrecioDia);
        let subtotal = r2(precio * tiempo), nota = '';
        const th = this.tarifa;
        if (th && th.ajustes && (tipo === 'Dia' || (tipo === 'Momento' && th.aplicaMomento))) {
            const d = new Date(); if (d.getHours() < 8) d.setDate(d.getDate() - 1);
            let aj = 0;
            if (tipo === 'Dia') {
                subtotal = 0;
                for (let i = 0; i < tiempo; i++) { const p = th.ajustes[clave(d)] || 0; if (p) aj++; subtotal += r2(precio * (1 + p / 100)); d.setDate(d.getDate() + 1); }
            } else { const p = th.ajustes[clave(d)] || 0; if (p) aj = 1; subtotal = r2(precio * (1 + p / 100)) * tiempo; }
            subtotal = r2(subtotal);
            if (aj) nota = `Tarifa del día: ${aj} con ajuste · base ${money(precio * tiempo)}`;
        }
        const tr = this.tarifaReserva;
        if (this.reserva && tr && tipo === 'Dia' && tiempo === tr.noches && tr.total > 0) { subtotal = tr.total; nota = `Tarifa garantizada de la reserva ${tr.codigo || ''}`; }
        const total = Math.max(0, r2(subtotal - desc));
        const ant = this.reserva && tr ? tr.anticipo : 0;
        if (ant > 0) nota += `${nota ? ' · ' : ''}Anticipo en caja ${money(ant)}`;
        this._total = total;
        $('rm-total').textContent = money(total);
        $('rm-nota').textContent = nota;
        if ($('rm-monto') && !this._montoTocado) $('rm-monto').value = Math.max(0, r2(total - ant)).toFixed(2);
        if ($('rm-monto') && !$('rm-monto')._ev) { $('rm-monto')._ev = true; $('rm-monto').addEventListener('input', () => { this._montoTocado = true; }); }
        this.renderDesayuno(tipo);
    },

    renderDesayuno(tipo) {
        const box = $('rm-desayuno'), t = this.desayuno;
        if (!box) return;
        if (!t || !t.Modo || t.Modo === 'NINGUNO' || tipo === 'Momento') { box.style.display = 'none'; return; }
        box.style.display = 'block';
        const hues = (parseInt($('rm-adultos').value) || 1) + (parseInt($('rm-ninos').value) || 0);
        const tope = t.Modo === 'INCLUIDO' ? Math.min(hues, t.Personas || hues) : hues;
        const inP = $('rm-des-personas');
        if (!this._desTocado || !(parseInt(inP.value) >= 1)) inP.value = tope;
        inP.max = tope;
        const on = $('rm-des-tomar').checked;
        $('rm-des-box').style.display = on ? 'flex' : 'none';
        if (t.Modo === 'INCLUIDO') {
            $('rm-des-lbl').textContent = '☕ DESAYUNO INCLUIDO';
            $('rm-des-nota').textContent = on ? 'Sin costo adicional' : 'No tomará el desayuno incluido';
        } else {
            const p = Number(t.Precio || 0), n = parseInt(inP.value) || 0;
            $('rm-des-lbl').textContent = `☕ AGREGAR DESAYUNO (${money(p)} c/u por día)`;
            $('rm-des-nota').textContent = on ? `Se carga al folio cada mañana que se sirve: ${n} × ${money(p)}` : '';
        }
    },

    async confirmar() {
        const u = this.unidad; if (!u) return;
        const nombre = $('rm-nombre').value.trim(), doc = $('rm-doc').value.trim();
        if (!doc || !nombre) return Swal.fire({ icon: 'warning', text: 'Documento y nombre del huésped son obligatorios.' });
        const tipo = $('rm-tipo').value, tiempo = Math.max(1, parseInt($('rm-tiempo').value) || 1);
        const monto = this.cajaId ? (parseFloat($('rm-monto').value) || 0) : 0;
        const metodo = $('rm-metodo').value;
        const noEf = window.MetodosPago ? MetodosPago.esNoEfectivo(metodo) : (metodo === '2' || metodo === '3');
        const archivo = $('rm-voucher') && $('rm-voucher').files[0];
        if (monto > 0 && noEf && !archivo) return Swal.fire({ icon: 'warning', text: 'Para un pago que no es en efectivo adjunte la foto del comprobante.' });
        if (monto > this._total + 0.01) return Swal.fire({ icon: 'warning', text: `El cobro (${money(monto)}) supera el total (${money(this._total)}).` });

        const ok = await Swal.fire({ icon: 'question', title: `Check-in hab. ${u.NroHabitacion}`,
            html: `${esc(nombre)}<br>Total ${money(this._total)} · cobrar ahora ${money(monto)}`, showCancelButton: true,
            confirmButtonText: 'REGISTRAR', cancelButtonText: 'REVISAR' });
        if (!ok.isConfirmed) return;

        const us = usuario();
        const fd = new FormData();
        fd.append('sedeId', sedeActual());
        fd.append('usuarioId', us.UsuarioID);
        fd.append('cajaId', this.cajaId);
        fd.append('habitacionId', u.HabitacionID);
        fd.append('esMigracion', false);
        fd.append('tipoAlquiler', tipo);
        fd.append('tiempoAsignado', tipo === 'Momento' ? tiempo * (u.HorasMomento || 3) : tiempo);
        fd.append('totalHospedaje', this._total);
        fd.append('placaVehiculo', '');
        fd.append('espacioParqueoId', '');
        fd.append('nroAdultos', $('rm-adultos').value || 1);
        fd.append('nroNinos', $('rm-ninos').value || 0);
        fd.append('acompanantes', '[]');
        fd.append('origen', 'MOVIL');
        fd.append('cliente', JSON.stringify({ Documento: doc, NombreFull: nombre, Telefono: $('rm-tel').value.trim(),
            Procedencia: $('rm-proc').value.trim(), Correo: $('rm-correo').value.trim(), FechaNacimiento: this._nacimiento || null, ...this.consent }));
        fd.append('pago', JSON.stringify({ Monto: monto, MetodoID: metodo, Referencia: ($('rm-ref') && $('rm-ref').value) || '' }));
        if (this.reserva) fd.append('reservaId', this.reserva.ReservaID);
        if (u.CamaID) fd.append('camaId', u.CamaID);
        const box = $('rm-desayuno');
        if (box && box.style.display !== 'none') fd.append('desayuno', JSON.stringify({ tomar: $('rm-des-tomar').checked, personas: parseInt($('rm-des-personas').value) || null }));
        if (archivo && monto > 0) fd.append('voucher', archivo);

        const btn = $('rm-confirmar'); btn.disabled = true; btn.textContent = 'REGISTRANDO…';
        try {
            const { data } = await api.post('/recepcion/checkin', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
            if (window.Alertas) window.Alertas.notificar('exito', `Check-in registrado en la habitación ${u.NroHabitacion}.`);
            await Swal.fire({ icon: 'success', title: 'INGRESO EXITOSO', text: `${data.fechaEntradaFmt ? 'Ingreso: ' + data.fechaEntradaFmt : ''}` +
                `${data.anticipoAplicado > 0 ? ` · anticipo aplicado ${money(data.anticipoAplicado)}` : ''}` });
            this.cerrarCheckIn();
        } catch (e) {
            btn.disabled = false; btn.textContent = 'CONFIRMAR INGRESO';
            Swal.fire({ icon: 'error', title: 'NO SE REGISTRÓ', text: e.response?.data?.error || 'Error en el check-in' });
        }
    },

    async desdeReserva(reservaId) {
        const rv = this.reservas.find(r => r.ReservaID === reservaId);
        if (!rv) return;
        const libres = this.unidades().filter(x => x.Estado === 'DISPONIBLE' && x.Categoria === rv.TipoNombre);
        if (!libres.length) return Swal.fire({ icon: 'warning', title: 'SIN HABITACIONES LIBRES', text: `No hay ${rv.TipoNombre || 'habitaciones'} disponibles ahora.` });
        const opciones = {};
        libres.forEach(x => { opciones[x._clave] = `Hab. ${x.NroHabitacion} (piso ${x.Piso})`; });
        const { value } = await Swal.fire({ title: 'ASIGNAR HABITACIÓN', input: 'select', inputOptions: opciones,
            inputValue: libres[0]._clave, showCancelButton: true, confirmButtonText: 'CONTINUAR', cancelButtonText: 'CANCELAR' });
        if (!value) return;
        const u = libres.find(x => x._clave === value);
        this.tarifaReserva = null;
        this._montoTocado = false;
        this.abrirCheckIn(u, rv);
    },
};

window.RecepcionMovilModule = RecepcionMovilModule;
module.exports = RecepcionMovilModule;
