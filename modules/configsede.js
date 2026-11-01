// configsede.js — Configuración de Sede (admin)
// Métodos de pago y comisión · canales de reserva y conexión del channel manager ·
// centros de costo (USALI) y rubros · clasificación de movimientos sin centro · políticas.
const api = require('./api');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + (parseFloat(n) || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hoyISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const errMsg = e => (e && e.response && e.response.data && (e.response.data.error || e.response.data.message)) || (e && e.message) || 'Error';

const ConfigSedeModule = {
    data: null,
    sinCentro: [],
    seleccion: new Set(),

    async init() {
        window.ConfigSedeModule = this;
        if (typeof Router !== 'undefined') Router.showBack(false);
        window.backView = 'dashboard';

        const primeroMes = hoyISO().slice(0, 8) + '01';
        document.getElementById('cs-res-desde').value = primeroMes;
        document.getElementById('cs-res-hasta').value = hoyISO();
        document.getElementById('cs-cl-desde').value = '2020-01-01';
        document.getElementById('cs-cl-hasta').value = hoyISO();

        App.renderSedeSelector('sedeSelectorConfig', () => this.recargar());
        await this.recargar();
    },

    getSedeId() {
        const sel = document.getElementById('globalSedeSelector');
        return sel ? sel.value : (localStorage.getItem('currentSedeId') || App.user.SedeID);
    },

    tab(nombre) {
        document.querySelectorAll('#seccion-configsede .cs-tab').forEach(b => b.classList.toggle('activa', b.dataset.tab === nombre));
        document.querySelectorAll('#seccion-configsede .cs-tabpanel').forEach(p => p.style.display = p.dataset.panel === nombre ? '' : 'none');
        if (nombre === 'clasificar' && !this.sinCentro.length) this.cargarSinCentro();
        if (nombre === 'centros') this.cargarResumen();
    },

    async recargar() {
        try {
            const r = await api.get('/config-sede', { params: { sedeId: this.getSedeId() } });
            this.data = r.data;
            if (window.MetodosPago) window.MetodosPago.invalidar();
            this.renderMetodos();
            this.renderCanales();
            this.renderCentros();
            this.renderRubros();
            this.renderParametros();
            this.renderWebhook();
            const pill = document.getElementById('cs-pill-sin');
            pill.textContent = this.data.sinCentro;
            pill.style.display = this.data.sinCentro > 0 ? '' : 'none';
            // repoblar el select de centros (cambió la sede)
            const sel = document.getElementById('cs-cl-centro');
            if (sel && window.MetodosPago) { delete sel.dataset.ccListo; window.MetodosPago.poblarCentros(sel); }
            this.sinCentro = []; this.seleccion.clear();
            document.getElementById('cs-sin-centro').innerHTML = '';
        } catch (e) {
            Swal.fire('No se pudo cargar', errMsg(e), 'error');
        }
    },

    // ---------------- MÉTODOS DE PAGO ----------------
    renderMetodos() {
        const tb = document.getElementById('cs-metodos');
        tb.innerHTML = this.data.metodos.map((m, i) => `
            <tr data-id="${m.MetodoID}">
                <td><label class="switch"><input type="checkbox" class="m-activo" ${m.Activo ? 'checked' : ''} ${m.MetodoID === 1 ? 'disabled title="El efectivo siempre está activo (arqueo de caja)"' : ''}><span></span></label></td>
                <td><b>${esc(m.Nombre)}</b>${m.ActivoGlobal === false ? ' <small style="color:#e74c3c">(desactivado globalmente)</small>' : ''}</td>
                <td><span class="badge b-${esc(m.Grupo)}">${esc(m.Grupo || '—')}</span></td>
                <td><input type="number" class="m-com" min="0" max="100" step="0.01" value="${parseFloat(m.ComisionPct) || 0}"></td>
                <td><input type="number" class="m-orden" min="0" step="1" value="${m.Orden ?? i}"></td>
            </tr>`).join('');
    },

    async guardarMetodos() {
        const metodos = [...document.querySelectorAll('#cs-metodos tr')].map(tr => ({
            MetodoID: parseInt(tr.dataset.id),
            Activo: tr.querySelector('.m-activo').checked,
            ComisionPct: tr.querySelector('.m-com').value,
            Orden: tr.querySelector('.m-orden').value,
        }));
        try {
            await api.put('/config-sede/metodos', { SedeID: this.getSedeId(), metodos });
            window.Toast.fire({ icon: 'success', title: 'MÉTODOS DE PAGO GUARDADOS' });
            await this.recargar();
        } catch (e) { Swal.fire('No se guardó', errMsg(e), 'error'); }
    },

    async nuevoMetodo() {
        const { value } = await Swal.fire({
            title: 'Nuevo método de pago',
            html: `<input id="nm-nombre" class="swal2-input" placeholder="Ej: PayPhone, Crédito empresa, De Una">
                   <select id="nm-grupo" class="swal2-input">
                     <option value="TRANSFERENCIA">Transferencia / depósito bancario</option>
                     <option value="TARJETA">Tarjeta (datáfono)</option>
                     <option value="DIGITAL">Billetera digital / link de pago</option>
                     <option value="EFECTIVO">Efectivo (otra moneda, etc.)</option>
                   </select>
                   <p style="font-size:.75rem;color:#7f8c8d;margin-top:10px;">El grupo define en qué columna del arqueo de caja cae.</p>`,
            showCancelButton: true, confirmButtonText: 'Crear', confirmButtonColor: '#1a365d',
            preConfirm: () => {
                const Nombre = document.getElementById('nm-nombre').value.trim();
                if (!Nombre) { Swal.showValidationMessage('Escribe el nombre'); return false; }
                return { Nombre, Grupo: document.getElementById('nm-grupo').value };
            }
        });
        if (!value) return;
        try {
            await api.post('/config-sede/metodos', { ...value, SedeID: this.getSedeId() });
            window.Toast.fire({ icon: 'success', title: 'MÉTODO CREADO' });
            await this.recargar();
        } catch (e) { Swal.fire('No se creó', errMsg(e), 'error'); }
    },

    // ---------------- CANALES ----------------
    renderCanales() {
        const tb = document.getElementById('cs-canales');
        tb.innerHTML = this.data.canales.length ? this.data.canales.map(c => `
            <tr data-id="${c.CanalID}" data-orden="${c.Orden}">
                <td><label class="switch"><input type="checkbox" class="c-activo" ${c.Activo ? 'checked' : ''}><span></span></label></td>
                <td><input type="text" class="c-nombre" value="${esc(c.Nombre)}"></td>
                <td><code>${esc(c.Codigo)}</code></td>
                <td><input type="number" class="c-com" min="0" max="100" step="0.01" value="${parseFloat(c.ComisionPct) || 0}"></td>
                <td class="num">${c.Reservas}</td>
            </tr>`).join('') : '<tr><td colspan="5" class="vacio">Sin canales</td></tr>';
    },

    async guardarCanales() {
        const canales = [...document.querySelectorAll('#cs-canales tr[data-id]')].map(tr => ({
            CanalID: parseInt(tr.dataset.id),
            Nombre: tr.querySelector('.c-nombre').value,
            ComisionPct: tr.querySelector('.c-com').value,
            Activo: tr.querySelector('.c-activo').checked,
            Orden: parseInt(tr.dataset.orden) || 0,
        }));
        try {
            await api.put('/config-sede/canales', { SedeID: this.getSedeId(), canales });
            window.Toast.fire({ icon: 'success', title: 'CANALES GUARDADOS' });
            await this.recargar();
        } catch (e) { Swal.fire('No se guardó', errMsg(e), 'error'); }
    },

    async nuevoCanal() {
        const { value } = await Swal.fire({
            title: 'Nuevo canal de venta',
            html: `<input id="nc-nombre" class="swal2-input" placeholder="Nombre (ej. Despegar)">
                   <input id="nc-codigo" class="swal2-input" placeholder="Código (ej. DESPEGAR)" style="text-transform:uppercase">
                   <input id="nc-com" type="number" class="swal2-input" placeholder="Comisión %" min="0" max="100" step="0.01">`,
            showCancelButton: true, confirmButtonText: 'Crear', confirmButtonColor: '#1a365d',
            didOpen: () => {
                const n = document.getElementById('nc-nombre'), c = document.getElementById('nc-codigo');
                n.addEventListener('input', () => { if (!c.dataset.tocado) c.value = n.value.toUpperCase().normalize('NFD').replace(/[^A-Z0-9]/g, '').slice(0, 30); });
                c.addEventListener('input', () => { c.dataset.tocado = '1'; });
            },
            preConfirm: () => {
                const Nombre = document.getElementById('nc-nombre').value.trim();
                const Codigo = document.getElementById('nc-codigo').value.trim();
                if (!Nombre || !Codigo) { Swal.showValidationMessage('Nombre y código son obligatorios'); return false; }
                return { Nombre, Codigo, ComisionPct: document.getElementById('nc-com').value || 0 };
            }
        });
        if (!value) return;
        try {
            await api.post('/config-sede/canales', { ...value, SedeID: this.getSedeId() });
            window.Toast.fire({ icon: 'success', title: 'CANAL CREADO' });
            await this.recargar();
        } catch (e) { Swal.fire('No se creó', errMsg(e), 'error'); }
    },

    renderWebhook() {
        const base = ((window.AppConfig && window.AppConfig.apiUrl) || '').replace(/\/api\/?$/, '');
        const saas = !!this.data.modoSaaS;
        document.getElementById('cs-webhook-url').textContent = saas
            ? 'En la versión en la nube la URL y la clave del webhook están en Integraciones (son por hotel).'
            : `POST ${base}/webhooks/reserva\nHeader: X-Webhook-Secret: <clave>`;
        const inp = document.getElementById('cs-webhook-secret');
        inp.disabled = saas;
        const est = document.getElementById('cs-webhook-estado');
        est.textContent = saas ? '' : (this.data.secretosSet.WEBHOOK_SECRET
            ? '✔ Esta sede tiene su propia clave.'
            : (this.data.webhookEnvFallback ? 'Usando la clave general del servidor.' : '⚠ No hay ninguna clave configurada: el webhook rechazará todo.'));
        const canalesOta = this.data.canales.filter(c => c.ComisionPct > 0).map(c => c.Codigo);
        document.getElementById('cs-webhook-ejemplo').textContent = JSON.stringify({
            sedeId: parseInt(this.getSedeId()), fuente: canalesOta[0] || 'BOOKING', canal_reserva_id: 'BDC-98765',
            nombre: 'Juan Pérez', documento: '1712345678', telefono: '+593999999999', correo: 'juan@correo.com',
            fecha_llegada: '2026-12-10', fecha_salida: '2026-12-12', tipo_id: 1, nro_adultos: 2, nro_ninos: 0,
            total: 120.0, anticipo: 60.0, notas: 'Cama extra'
        }, null, 2);
    },

    generarClave() {
        const bytes = new Uint8Array(24);
        crypto.getRandomValues(bytes);
        const clave = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
        const inp = document.getElementById('cs-webhook-secret');
        inp.value = clave;
        Swal.fire({
            icon: 'info', title: 'Clave generada',
            html: `Cópiala ahora y pégala en tu channel manager. Después de guardar solo se mostrará enmascarada.<div class="codigo" style="margin-top:12px;font-family:Consolas,monospace;word-break:break-all;">${clave}</div>`,
            confirmButtonColor: '#1a365d'
        });
    },

    // ---------------- PARÁMETROS / POLÍTICAS ----------------
    renderParametros() {
        document.querySelectorAll('#seccion-configsede [data-param]').forEach(el => {
            el.value = this.data.config[el.dataset.param] ?? '';
        });
    },

    async guardarParametros(claves) {
        const config = {};
        claves.forEach(k => {
            const el = document.querySelector(`#seccion-configsede [data-param="${k}"]`);
            if (el && !el.disabled) config[k] = el.value;
        });
        try {
            await api.put('/config-sede/parametros', { SedeID: this.getSedeId(), config });
            window.Toast.fire({ icon: 'success', title: 'GUARDADO' });
            await this.recargar();
        } catch (e) { Swal.fire('No se guardó', errMsg(e), 'error'); }
    },

    // ---------------- CENTROS DE COSTO ----------------
    renderCentros() {
        const tb = document.getElementById('cs-centros');
        tb.innerHTML = this.data.centros.map(c => `
            <tr>
                <td><label class="switch"><input type="checkbox" ${c.Activo ? 'checked' : ''} ${c.EsSistema ? 'disabled title="Centro estándar: se puede renombrar, no desactivar"' : ''}
                     onchange="ConfigSedeModule.actualizarCentro(${c.CentroCostoID}, { Activo: this.checked })"><span></span></label></td>
                <td><code><b>${esc(c.Codigo)}</b></code></td>
                <td>${esc(c.Nombre)}</td>
                <td><span class="badge b-${esc(c.Tipo)}">${c.Tipo === 'OPERATIVO' ? 'OPERATIVO' : 'NO DISTRIBUIDO'}</span></td>
                <td class="num">${c.Movimientos}</td>
                <td><button class="cs-btn" style="padding:6px 10px;" title="Renombrar" onclick="ConfigSedeModule.renombrarCentro(${c.CentroCostoID})"><i class="fas fa-pen"></i></button></td>
            </tr>`).join('');
    },

    async renombrarCentro(id) {
        const c = this.data.centros.find(x => x.CentroCostoID === id);
        const { value } = await Swal.fire({
            title: `Renombrar ${c.Codigo}`, input: 'text', inputValue: c.Nombre,
            showCancelButton: true, confirmButtonText: 'Guardar', confirmButtonColor: '#1a365d',
            inputValidator: v => !v.trim() && 'Escribe un nombre'
        });
        if (value) await this.actualizarCentro(id, { Nombre: value.trim() });
    },

    async actualizarCentro(id, cambios) {
        try {
            await api.put(`/config-sede/centros/${id}`, { SedeID: this.getSedeId(), ...cambios });
            window.Toast.fire({ icon: 'success', title: 'CENTRO ACTUALIZADO' });
        } catch (e) { Swal.fire('No se actualizó', errMsg(e), 'error'); }
        await this.recargar();
    },

    async nuevoCentro() {
        const { value } = await Swal.fire({
            title: 'Nuevo centro de costo',
            html: `<input id="ncc-nombre" class="swal2-input" placeholder="Nombre (ej. Spa, Lavandería, Tienda)">
                   <input id="ncc-codigo" class="swal2-input" placeholder="Código corto (ej. SPA)" style="text-transform:uppercase" maxlength="10">
                   <select id="ncc-tipo" class="swal2-input">
                     <option value="OPERATIVO">Operativo (genera ingresos)</option>
                     <option value="NO_DISTRIBUIDO">No distribuido (gasto general)</option>
                   </select>`,
            showCancelButton: true, confirmButtonText: 'Crear', confirmButtonColor: '#1a365d',
            preConfirm: () => {
                const Nombre = document.getElementById('ncc-nombre').value.trim();
                const Codigo = document.getElementById('ncc-codigo').value.trim();
                if (!Nombre || !Codigo) { Swal.showValidationMessage('Nombre y código son obligatorios'); return false; }
                return { Nombre, Codigo, Tipo: document.getElementById('ncc-tipo').value };
            }
        });
        if (!value) return;
        try {
            await api.post('/config-sede/centros', { ...value, SedeID: this.getSedeId() });
            window.Toast.fire({ icon: 'success', title: 'CENTRO CREADO' });
            await this.recargar();
        } catch (e) { Swal.fire('No se creó', errMsg(e), 'error'); }
    },

    renderRubros() {
        const opts = cod => '<option value="">— ninguno —</option>' + this.data.centros.filter(c => c.Activo)
            .map(c => `<option value="${esc(c.Codigo)}" ${c.Codigo === cod ? 'selected' : ''}>${esc(c.Codigo)} · ${esc(c.Nombre)}</option>`).join('');
        document.getElementById('cs-rubros').innerHTML = this.data.rubros.map(r => `
            <tr>
                <td><b>${esc(r.Nombre)}</b><br><small style="color:${r.Tipo === 'Ingreso' ? '#27ae60' : '#e74c3c'}; font-weight:800;">${esc(r.Tipo).toUpperCase()}</small></td>
                <td style="width:55%;"><select style="width:100%;" onchange="ConfigSedeModule.rubroCentro(${r.RubroID}, this.value)">${opts(r.CentroCostoCodigo)}</select></td>
            </tr>`).join('');
    },

    async rubroCentro(rubroId, codigo) {
        try {
            await api.put(`/config-sede/rubros/${rubroId}`, { SedeID: this.getSedeId(), CentroCostoCodigo: codigo || null });
            window.Toast.fire({ icon: 'success', title: 'RUBRO ACTUALIZADO' });
        } catch (e) { Swal.fire('No se guardó', errMsg(e), 'error'); }
    },

    async cargarResumen() {
        const tb = document.getElementById('cs-resumen');
        try {
            const r = await api.get('/config-sede/resumen-centros', { params: {
                sedeId: this.getSedeId(),
                desde: document.getElementById('cs-res-desde').value,
                hasta: document.getElementById('cs-res-hasta').value,
            } });
            if (!r.data.length) { tb.innerHTML = '<tr><td colspan="4" class="vacio">Sin movimientos en el período</td></tr>'; return; }
            let ti = 0, te = 0;
            tb.innerHTML = r.data.map(x => {
                const neto = x.Ingresos - x.Egresos; ti += x.Ingresos; te += x.Egresos;
                return `<tr${x.Codigo === '-' ? ' style="color:#e67e22;"' : ''}>
                    <td><b>${esc(x.Codigo === '-' ? 'SIN ASIGNAR' : x.Codigo)}</b> <small>${esc(x.Codigo === '-' ? '' : x.Nombre)}</small></td>
                    <td class="num">${money(x.Ingresos)}</td><td class="num">${money(x.Egresos)}</td>
                    <td class="num" style="font-weight:900; color:${neto >= 0 ? '#27ae60' : '#e74c3c'}">${money(neto)}</td></tr>`;
            }).join('') + `<tr style="border-top:2px solid #1a365d;"><td><b>TOTAL</b></td><td class="num"><b>${money(ti)}</b></td><td class="num"><b>${money(te)}</b></td><td class="num"><b>${money(ti - te)}</b></td></tr>`;
        } catch (e) { tb.innerHTML = `<tr><td colspan="4" class="vacio">${esc(errMsg(e))}</td></tr>`; }
    },

    // ---------------- CLASIFICAR ----------------
    async cargarSinCentro() {
        const tb = document.getElementById('cs-sin-centro');
        tb.innerHTML = '<tr><td colspan="6" class="vacio"><i class="fas fa-spinner fa-spin"></i> Cargando…</td></tr>';
        try {
            const r = await api.get('/config-sede/sin-centro', { params: {
                sedeId: this.getSedeId(),
                desde: document.getElementById('cs-cl-desde').value,
                hasta: document.getElementById('cs-cl-hasta').value,
                tipo: document.getElementById('cs-cl-tipo').value,
            } });
            this.sinCentro = r.data;
            this.seleccion.clear();
            this.renderSinCentro();
        } catch (e) { tb.innerHTML = `<tr><td colspan="6" class="vacio">${esc(errMsg(e))}</td></tr>`; }
    },

    visibles() {
        const q = (document.getElementById('cs-cl-buscar').value || '').toLowerCase().trim();
        return q ? this.sinCentro.filter(m => `${m.Observacion} ${m.Rubro || ''}`.toLowerCase().includes(q)) : this.sinCentro;
    },

    renderSinCentro() {
        const tb = document.getElementById('cs-sin-centro');
        const lista = this.visibles();
        if (!lista.length) {
            tb.innerHTML = `<tr><td colspan="6" class="vacio">${this.sinCentro.length ? 'Nada coincide con el filtro' : '🎉 Todo está clasificado'}</td></tr>`;
        } else {
            tb.innerHTML = lista.map(m => `
                <tr>
                    <td><input type="checkbox" ${this.seleccion.has(m.MovimientoID) ? 'checked' : ''} onchange="ConfigSedeModule.marcar(${m.MovimientoID}, this.checked)"></td>
                    <td style="white-space:nowrap;">${esc(m.Fecha)}</td>
                    <td><span style="font-weight:900; color:${m.TipoMovimiento === 'Ingreso' ? '#27ae60' : '#e74c3c'}">${esc(m.TipoMovimiento).toUpperCase()}</span></td>
                    <td>${esc(m.Observacion || '—')}${m.CierreMaestroID ? ' <i class="fas fa-lock" title="Período auditado: solo cambia la clasificación" style="color:#95a5a6;font-size:.7rem;"></i>' : ''}</td>
                    <td><small>${esc(m.Rubro || '')}</small></td>
                    <td class="num">${money(m.Monto)}</td>
                </tr>`).join('');
        }
        this.actualizarContador();
    },

    marcar(id, on) { on ? this.seleccion.add(id) : this.seleccion.delete(id); this.actualizarContador(); },

    marcarTodos(on) {
        this.visibles().forEach(m => on ? this.seleccion.add(m.MovimientoID) : this.seleccion.delete(m.MovimientoID));
        this.renderSinCentro();
    },

    actualizarContador() {
        const sel = this.sinCentro.filter(m => this.seleccion.has(m.MovimientoID));
        const total = sel.reduce((a, m) => a + parseFloat(m.Monto), 0);
        document.getElementById('cs-cl-sel').textContent = `${sel.length} seleccionado(s) · ${money(total)}`;
    },

    async asignarSeleccionados() {
        const ids = [...this.seleccion];
        const centro = document.getElementById('cs-cl-centro').value;
        if (!ids.length) return Swal.fire('Nada seleccionado', 'Marca los movimientos que quieres clasificar.', 'info');
        if (!centro) return Swal.fire('Elige el centro', 'Selecciona a qué centro de costo pertenecen.', 'info');
        const nombre = document.getElementById('cs-cl-centro').selectedOptions[0].textContent;
        const ok = await Swal.fire({
            icon: 'question', title: `¿Asignar ${ids.length} movimiento(s)?`, html: `Centro: <b>${esc(nombre)}</b><br><small>Queda registrado en la auditoría.</small>`,
            showCancelButton: true, confirmButtonText: 'Asignar', confirmButtonColor: '#1a365d'
        });
        if (!ok.isConfirmed) return;
        try {
            const r = await api.post('/config-sede/asignar-centro', { SedeID: this.getSedeId(), ids, CentroCostoID: parseInt(centro) });
            window.Toast.fire({ icon: 'success', title: `${r.data.asignados} CLASIFICADO(S)` });
            const hechos = new Set(ids);
            this.sinCentro = this.sinCentro.filter(m => !hechos.has(m.MovimientoID));
            this.seleccion.clear();
            this.renderSinCentro();
            this.data.sinCentro = Math.max(0, this.data.sinCentro - r.data.asignados);
            const pill = document.getElementById('cs-pill-sin');
            pill.textContent = this.data.sinCentro; pill.style.display = this.data.sinCentro > 0 ? '' : 'none';
        } catch (e) { Swal.fire('No se asignó', errMsg(e), 'error'); }
    },
};

module.exports = ConfigSedeModule;
