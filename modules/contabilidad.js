// contabilidad.js — Contabilidad de partida doble (Fase 4)
// Estado y conciliaciones, libro diario (con asientos manuales, anular y revertir),
// libro mayor, balances (resultados por centro, comprobación, general), plan de
// cuentas, cuentas automáticas por rubro y cierre de periodos. Todo el cálculo lo
// hace el backend (/api/contabilidad); el motor contabiliza lo pendiente solo.
const api = require('./api');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => n == null ? '' : (Number(n) < 0 ? '-' : '') + '$' + Math.abs(parseFloat(n) || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cifra = n => Number(n) ? money(n) : '';
const hoyISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const errMsg = e => (e && e.response && e.response.data && (e.response.data.error || e.response.data.message)) || (e && e.message) || 'Error';
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const ORIGEN = { CAJA: 'Caja', PAGO: 'Pago', COMPRA: 'Compra', INVENTARIO: 'Inventario', DEPRECIACION: 'Depreciación', APERTURA: 'Apertura', MANUAL: 'Manual', REVERSO: 'Reverso' };
const CLAVES = {
    TESORERIA_EFECTIVO: 'Cobros y pagos en efectivo', TESORERIA_TRANSFERENCIA: 'Transferencias', TESORERIA_TARJETA: 'Tarjetas (hasta que acredite el banco)',
    TESORERIA_DIGITAL: 'Pagos digitales', INGRESO_HAB: 'Ingresos de Habitaciones', INGRESO_AYB: 'Ingresos de Alimentos y Bebidas', INGRESO_EVE: 'Ingresos de Eventos',
    INGRESO_PAR: 'Ingresos de Parqueadero', INGRESO_OTROS: 'Ingresos sin centro operativo', IVA_VENTAS: 'IVA cobrado', IVA_COMPRAS: 'IVA en compras',
    RET_FUENTE_POR_PAGAR: 'Retenciones de renta por pagar', RET_IVA_POR_PAGAR: 'Retenciones de IVA por pagar', PROVEEDORES: 'Proveedores',
    COMPRAS_POR_LIQUIDAR: 'Puente: compras de inventario', INVENTARIO: 'Inventarios', COSTO_AYB: 'Costo de lo vendido (A&B)', COSTO_AMENITIES: 'Kits de habitación',
    COSTO_MANTENIMIENTO: 'Materiales de mantenimiento', MERMAS: 'Mermas', SOBRANTES: 'Sobrantes de inventario', GASTO_GENERAL: 'Egresos sin cuenta en su rubro',
    PENDIENTE_CLASIFICAR: 'Egresos que no son gasto, sin cuenta', SUELDOS_GASTO: 'Nómina, bonos, horas extra', BENEFICIOS_GASTO: 'Liquidaciones',
    ANTICIPO_EMPLEADOS: 'Adelantos al personal', COMISIONES_TARJETA: 'Comisiones de métodos de pago', ACTIVOS_PPE: 'Activos fijos',
    ACTIVOS_DEP_ACUM: 'Depreciación acumulada', ACTIVOS_GASTO_DEPRECIACION: 'Gasto depreciación', APERTURA_PATRIMONIO: 'Contrapartida de apertura',
};

const ContaModule = {
    cuentas: [],
    centros: [],
    sub: 'resultados',
    ultimoBalance: null,
    lineasNuevo: [],

    async init() {
        window.ContaModule = this;
        window.backView = 'dashboard';
        const ini = hoyISO().slice(0, 8) + '01';
        for (const p of ['d', 'm', 'b']) { document.getElementById(`ct-${p}-desde`).value = ini; document.getElementById(`ct-${p}-hasta`).value = hoyISO(); }
        const hoy = new Date();
        document.getElementById('ct-per-anio').value = hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear();
        document.getElementById('ct-per-mes').innerHTML = MESES.map((m, i) => `<option value="${i + 1}" ${i === (hoy.getMonth() + 11) % 12 ? 'selected' : ''}>${m}</option>`).join('');
        App.renderSedeSelector('sedeSelectorConta', () => this.recargar());
        await this.recargar();
    },

    getSedeId() {
        const sel = document.getElementById('globalSedeSelector');
        return sel ? sel.value : (localStorage.getItem('currentSedeId') || App.user.SedeID);
    },

    tab(nombre) {
        document.querySelectorAll('#seccion-conta .cc-tab').forEach(b => b.classList.toggle('activa', b.dataset.tab === nombre));
        document.querySelectorAll('#seccion-conta .cc-tabpanel').forEach(p => p.style.display = p.dataset.panel === nombre ? '' : 'none');
        ({ estado: () => this.cargarEstado(), diario: () => this.cargarDiario(), balances: () => this.cargarBalance(),
           plan: () => this.renderPlan(), mapeo: () => this.cargarMapeo(), periodos: () => this.cargarPeriodos() }[nombre] || (() => {}))();
    },

    async recargar() {
        try {
            const [p, c] = await Promise.all([api.get(`/contabilidad/plan/${this.getSedeId()}`), api.get('/config-sede/centros-lista', { params: { sedeId: this.getSedeId() } }).catch(() => ({ data: [] }))]);
            this.cuentas = p.data.cuentas || [];
            this.centros = Array.isArray(c.data) ? c.data : (c.data.centros || []);
        } catch (e) { return Swal.fire('Error', errMsg(e), 'error'); }
        document.getElementById('ct-m-cuenta').innerHTML = this.opcionesCuenta();
        const activa = document.querySelector('#seccion-conta .cc-tab.activa');
        this.tab(activa ? activa.dataset.tab : 'estado');
    },

    opcionesCuenta(sel, conVacia) {
        return (conVacia ? `<option value="">${conVacia}</option>` : '') + this.cuentas.filter(c => c.EsMovimiento && c.Estado)
            .map(c => `<option value="${c.CuentaID}" ${c.CuentaID === sel ? 'selected' : ''}>${esc(c.Codigo)} · ${esc(c.Nombre)}</option>`).join('');
    },

    // ---------------- ESTADO ----------------
    async cargarEstado() {
        const box = document.getElementById('ct-estado');
        box.innerHTML = '<div class="cc-panel"><div class="vacio"><i class="fas fa-spinner fa-spin"></i> Contabilizando lo pendiente…</div></div>';
        let d;
        try { d = (await api.get(`/contabilidad/estado/${this.getSedeId()}`)).data; }
        catch (e) { box.innerHTML = `<div class="cc-panel"><div class="vacio">${esc(errMsg(e))}</div></div>`; return; }
        if (!d.inicio) {
            box.innerHTML = `<div class="cc-panel">
                <h3><i class="fas fa-flag-checkered"></i> Iniciar la contabilidad de esta sede</h3>
                <p class="ayuda">Desde la fecha de inicio, el sistema contabiliza solo todo lo que ya registra el hotel: cobros y egresos de caja y finanzas, compras con IVA y retenciones,
                costo de lo vendido, kits de habitación, mantenimiento, mermas y depreciación. Se crea un asiento de apertura con el inventario valorizado y los activos fijos.
                Los saldos de caja y bancos a esa fecha los registra su contador con un asiento manual.</p>
                <p class="ayuda"><b>Antes de iniciar</b>, revise la pestaña <b>Cuentas automáticas</b> y asigne una cuenta a cada rubro de egreso: así los gastos quedan bien clasificados desde el primer día.</p>
                <div class="fila"><div class="campo"><label>Fecha de inicio</label><input type="date" id="ct-ini-fecha" value="${hoyISO().slice(0, 8)}01"></div>
                <button class="cc-btn ok" onclick="ContaModule.iniciar()"><i class="fas fa-play"></i> Iniciar contabilidad</button></div></div>`;
            return;
        }
        const c = d.conciliacion;
        const difInv = Math.round((c.inventarioContable - c.inventarioOperativo) * 100) / 100;
        const k = (t, v, sub, mal) => `<div class="kpi"><div class="t">${t}</div><div class="v" style="${mal ? 'color:#b03a2e;' : ''}">${v}</div><div class="muted">${sub || ''}</div></div>`;
        const avisos = [];
        if (d.corrida && d.corrida.errores && d.corrida.errores.length) avisos.push(`${d.corrida.errores.length} documento(s) no se pudieron contabilizar: ${esc(d.corrida.errores.slice(0, 3).join(' · '))}`);
        if (Math.abs(difInv) >= 1) avisos.push(`El inventario contable difiere del valorizado en ${money(difInv)}: revise ajustes de stock sin costo o compras sin valor.`);
        if (c.pendienteClasificar) avisos.push(`Hay ${money(c.pendienteClasificar)} en "Partidas pendientes de clasificar": egresos marcados como "no es gasto" sin cuenta. Asígneles cuenta en el rubro y use "Rehacer desde".`);
        if (c.gastoGeneral) avisos.push(`${money(c.gastoGeneral)} quedó en "Otros gastos" porque su rubro no tiene cuenta. Asigne cuentas en "Cuentas automáticas" para un estado de resultados útil.`);
        box.innerHTML = `<div class="cc-panel">
            <h3><i class="fas fa-gauge"></i> Contabilidad desde el ${esc(d.inicio.split('-').reverse().join('/'))}</h3>
            <p class="ayuda">Se contabiliza solo hasta ayer (días completos) cada vez que abre esta pantalla o un informe.
                ${d.corrida && d.corrida.asientos ? `Ahora se generaron <b>${d.corrida.asientos}</b> asiento(s).` : ''}
                Los cobros de centros operativos ${d.conIva ? `separan el IVA (${d.ivaPct}%)` : 'no separan IVA'}.</p>
            <div class="kpis">
                ${k('Asientos', d.asientos.Asientos || 0, `${d.asientos.Anulados || 0} anulados · último ${d.asientos.Ultimo ? d.asientos.Ultimo.split('-').reverse().join('/') : '—'}`)}
                ${k('Caja (contable)', money(c.caja))}${k('Bancos', money(c.bancos))}${k('Tarjetas por cobrar', money(c.tarjetas), 'baja cuando el banco acredita')}
                ${k('Inventario contable', money(c.inventarioContable), `valorizado ${money(c.inventarioOperativo)}`, Math.abs(difInv) >= 1)}
                ${k('Compras por liquidar', money(c.comprasPorLiquidar), c.comprasPorLiquidar > 0 ? 'recibido en bodega y no pagado' : c.comprasPorLiquidar < 0 ? 'pagado y no ingresado a bodega' : 'cuadrado')}
            </div>
            ${avisos.map(a => `<p class="ayuda" style="background:#fdebd0; color:#7e5109; padding:10px 12px; border-radius:12px; margin:8px 0 0;"><i class="fas fa-triangle-exclamation"></i> ${a}</p>`).join('')}
            ${c.cajaEliminados30d ? `<p class="ayuda" style="margin-top:10px;"><i class="fas fa-box-archive"></i> ${c.cajaEliminados30d} movimiento(s) de caja eliminados en los últimos 30 días quedaron archivados; sus asientos se anularon o revirtieron solos.</p>` : ''}
            <div class="fila" style="margin-top:14px;">
                <button class="cc-btn primary" onclick="ContaModule.contabilizar(true)"><i class="fas fa-bolt"></i> Contabilizar incluyendo hoy</button>
                <div class="campo"><label>Rehacer desde</label><input type="date" id="ct-rehacer" value="${hoyISO().slice(0, 8)}01"></div>
                <button class="cc-btn" onclick="ContaModule.rehacer()"><i class="fas fa-rotate-right"></i> Rehacer asientos automáticos</button>
            </div></div>`;
    },

    async iniciar() {
        const fecha = document.getElementById('ct-ini-fecha').value;
        const ok = await Swal.fire({ title: '¿Iniciar la contabilidad?', icon: 'question', showCancelButton: true, confirmButtonText: 'Iniciar',
            html: `Desde el <b>${esc(fecha.split('-').reverse().join('/'))}</b> todo lo que registre el hotel se contabilizará solo.<br>La fecha de inicio no se puede cambiar después.` });
        if (!ok.isConfirmed) return;
        try {
            const r = (await api.post('/contabilidad/iniciar', { SedeID: this.getSedeId(), fecha })).data;
            await Swal.fire('Contabilidad iniciada', `Apertura: inventario ${money(r.inventario)}, activos ${money(r.activos)} (depreciación ${money(r.depreciacion)}). ${r.corrida?.asientos || 0} asiento(s) generados.`, 'success');
            this.cargarEstado();
        } catch (e) { Swal.fire('No se inició', errMsg(e), 'error'); }
    },

    async contabilizar(incluirHoy) {
        try {
            const r = (await api.post('/contabilidad/contabilizar', { SedeID: this.getSedeId(), hasta: incluirHoy ? hoyISO() : undefined })).data;
            window.Toast && window.Toast.fire({ icon: r.errores.length ? 'warning' : 'success', title: `${r.asientos} asiento(s)${r.errores.length ? ` · ${r.errores.length} con error` : ''}` });
            this.cargarEstado();
        } catch (e) { Swal.fire('Error', errMsg(e), 'error'); }
    },

    async rehacer() {
        const desde = document.getElementById('ct-rehacer').value;
        const ok = await Swal.fire({ title: '¿Rehacer los asientos automáticos?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Rehacer',
            html: `Los asientos automáticos desde el <b>${esc(desde.split('-').reverse().join('/'))}</b> (solo periodos abiertos) se anulan —quedan guardados— y se generan de nuevo con las cuentas actuales.` });
        if (!ok.isConfirmed) return;
        try {
            const r = (await api.post('/contabilidad/reprocesar', { SedeID: this.getSedeId(), desde })).data;
            Swal.fire('Listo', `${r.anulados} asiento(s) anulados y ${r.asientos} generados de nuevo.`, 'success');
            this.cargarEstado();
        } catch (e) { Swal.fire('Error', errMsg(e), 'error'); }
    },

    // ---------------- LIBRO DIARIO ----------------
    async cargarDiario() {
        const v = id => document.getElementById(id).value;
        let items = [];
        try { items = (await api.get(`/contabilidad/asientos/${this.getSedeId()}`, { params: { desde: v('ct-d-desde'), hasta: v('ct-d-hasta'), origen: v('ct-d-origen') || undefined, buscar: v('ct-d-buscar') || undefined } })).data.items; }
        catch (e) { return Swal.fire('Error', errMsg(e), 'error'); }
        const box = document.getElementById('ct-diario');
        if (!items.length) { box.innerHTML = '<div class="vacio">Sin asientos en el período.</div>'; return; }
        box.innerHTML = `<table><thead><tr><th>N°</th><th>Fecha</th><th>Origen</th><th>Glosa</th><th class="num">Importe</th><th>Por</th><th></th></tr></thead><tbody>
            ${items.map(a => `<tr class="clic ${a.Estado === 'ANULADO' ? 'anulado' : ''}" onclick="ContaModule.verAsiento(${a.AsientoID})">
                <td><b>${a.Numero}</b></td><td>${esc(a.Fecha)}</td><td><span class="badge b-gris">${ORIGEN[a.Origen] || esc(a.Origen)}</span></td>
                <td>${esc(a.Glosa)}${a.RevertidoPor ? ` <span class="badge b-medio">REVERTIDO (N° ${a.RevertidoPor})</span>` : ''}</td>
                <td class="num">${money(a.TotalDebe)}</td><td class="muted">${esc(a.NombreUsuario || '')}</td>
                <td>${a.Estado === 'ANULADO' ? '<span class="badge b-alto">ANULADO</span>' : ''}</td></tr>`).join('')}</tbody></table>`;
    },

    async verAsiento(id) {
        let d;
        try { d = (await api.get(`/contabilidad/asiento/${id}`, { params: { sedeId: this.getSedeId() } })).data; }
        catch (e) { return Swal.fire('Error', errMsg(e), 'error'); }
        const a = d.asiento;
        const auto = ['CAJA', 'PAGO', 'COMPRA', 'INVENTARIO', 'DEPRECIACION'].includes(a.Origen);
        const r = await Swal.fire({
            title: `Asiento N° ${a.Numero}`, width: 820, showCloseButton: true,
            showConfirmButton: a.Estado === 'CONFIRMADO' && a.Origen !== 'REVERSO', confirmButtonText: 'Revertir', confirmButtonColor: '#b9770e',
            showDenyButton: a.Estado === 'CONFIRMADO' && !auto, denyButtonText: 'Anular',
            html: `<div style="text-align:left; font-size:.85rem;">
                <p><b>${esc(a.Fecha)}</b> · ${ORIGEN[a.Origen] || esc(a.Origen)}${a.OrigenID ? ` #${a.OrigenID}` : ''} · ${esc(a.NombreUsuario || '')} · creado ${esc(a.Creado)}</p>
                <p>${esc(a.Glosa)}</p>
                ${a.Estado === 'ANULADO' ? `<p style="color:#b03a2e;"><b>ANULADO</b> por ${esc(a.AnuladoPor)} el ${esc(a.FechaAnulacion)}: ${esc(a.MotivoAnulacion)}</p>` : ''}
                <table style="width:100%; border-collapse:collapse;"><tr style="text-align:left; border-bottom:1px solid #ccc;"><th>Cuenta</th><th>Centro</th><th style="text-align:right;">Debe</th><th style="text-align:right;">Haber</th></tr>
                ${d.lineas.map(l => `<tr><td>${esc(l.Codigo)} ${esc(l.CuentaNombre)}${l.Glosa ? `<div style="color:#7f8c8d; font-size:.75rem;">${esc(l.Glosa)}</div>` : ''}</td><td>${esc(l.Centro || '')}</td>
                    <td style="text-align:right;">${cifra(l.Debe)}</td><td style="text-align:right;">${cifra(l.Haber)}</td></tr>`).join('')}
                <tr style="border-top:2px solid #999; font-weight:bold;"><td colspan="2">Totales</td><td style="text-align:right;">${money(a.TotalDebe)}</td><td style="text-align:right;">${money(a.TotalHaber)}</td></tr></table>
                ${auto && a.Estado === 'CONFIRMADO' ? '<p style="color:#7f8c8d; margin-top:10px;">Asiento automático: se corrige en su documento de origen (o con "Rehacer desde"). Revertir crea un asiento espejo con fecha de hoy.</p>' : ''}</div>`,
        });
        if (r.isConfirmed) return this.accionAsiento(id, 'revertir');
        if (r.isDenied) return this.accionAsiento(id, 'anular');
    },

    async accionAsiento(id, accion) {
        const { value: motivo } = await Swal.fire({ title: accion === 'anular' ? 'Anular asiento' : 'Revertir asiento', input: 'text', inputPlaceholder: 'Motivo',
            showCancelButton: true, inputValidator: v => (!v || v.trim().length < 5) && 'Escriba el motivo' });
        if (!motivo) return;
        try {
            await api.post(`/contabilidad/asiento/${id}/${accion}`, { SedeID: this.getSedeId(), motivo });
            window.Toast && window.Toast.fire({ icon: 'success', title: accion === 'anular' ? 'Asiento anulado' : 'Asiento revertido' });
            this.cargarDiario();
        } catch (e) { Swal.fire('No se pudo', errMsg(e), 'error'); }
    },

    nuevoAsiento() {
        this.lineasNuevo = [{ cuentaId: '', debe: '', haber: '', centroCostoId: '' }, { cuentaId: '', debe: '', haber: '', centroCostoId: '' }];
        this.renderNuevo();
    },

    renderNuevo() {
        const optCentro = sel => '<option value="">—</option>' + this.centros.map(c => `<option value="${c.CentroCostoID}" ${String(c.CentroCostoID) === String(sel) ? 'selected' : ''}>${esc(c.Codigo)}</option>`).join('');
        document.getElementById('ct-nuevo').innerHTML = `<div class="cc-panel" style="margin-bottom:14px;">
            <h3><i class="fas fa-pen"></i> Asiento manual</h3>
            <div class="fila">
                <div class="campo"><label>Fecha</label><input type="date" id="ct-n-fecha" value="${hoyISO()}"></div>
                <div class="campo"><label>Referencia</label><input type="text" id="ct-n-ref" placeholder="Opcional"></div>
                <div class="campo" style="flex:1; min-width:260px;"><label>Glosa</label><input type="text" id="ct-n-glosa" placeholder="Qué registra este asiento"></div>
            </div>
            <table><thead><tr><th>Cuenta</th><th>Centro</th><th class="num">Debe</th><th class="num">Haber</th><th></th></tr></thead><tbody>
            ${this.lineasNuevo.map((l, i) => `<tr>
                <td><select style="width:100%;" onchange="ContaModule.setNuevo(${i}, 'cuentaId', this.value)">${this.opcionesCuenta(parseInt(l.cuentaId), '— Cuenta —')}</select></td>
                <td><select onchange="ContaModule.setNuevo(${i}, 'centroCostoId', this.value)">${optCentro(l.centroCostoId)}</select></td>
                <td><input type="number" step="0.01" min="0" style="width:110px;" value="${l.debe}" oninput="ContaModule.setNuevo(${i}, 'debe', this.value)"></td>
                <td><input type="number" step="0.01" min="0" style="width:110px;" value="${l.haber}" oninput="ContaModule.setNuevo(${i}, 'haber', this.value)"></td>
                <td><button class="cc-btn mini danger" onclick="ContaModule.lineasNuevo.splice(${i}, 1); ContaModule.renderNuevo();"><i class="fas fa-xmark"></i></button></td></tr>`).join('')}
            <tr class="total"><td colspan="2" id="ct-n-cuadre"></td><td class="num" id="ct-n-td"></td><td class="num" id="ct-n-th"></td><td></td></tr></tbody></table>
            <div class="barra" style="margin-top:10px;">
                <button class="cc-btn" onclick="ContaModule.lineasNuevo.push({ cuentaId: '', debe: '', haber: '', centroCostoId: '' }); ContaModule.renderNuevo();"><i class="fas fa-plus"></i> Línea</button>
                <label style="font-size:.75rem; font-weight:700;"><input type="checkbox" id="ct-n-apertura"> Es saldo de apertura</label>
                <button class="cc-btn" style="margin-left:auto;" onclick="document.getElementById('ct-nuevo').innerHTML='';">Cancelar</button>
                <button class="cc-btn ok" onclick="ContaModule.guardarNuevo()"><i class="fas fa-floppy-disk"></i> Registrar</button>
            </div></div>`;
        this.cuadre();
    },

    setNuevo(i, campo, v) { this.lineasNuevo[i][campo] = v; if (campo === 'debe' && Number(v)) this.lineasNuevo[i].haber = ''; if (campo === 'haber' && Number(v)) this.lineasNuevo[i].debe = ''; if (campo === 'cuentaId' || campo === 'centroCostoId') return; this.cuadre(); },

    cuadre() {
        const td = this.lineasNuevo.reduce((a, l) => a + (Number(l.debe) || 0), 0), th = this.lineasNuevo.reduce((a, l) => a + (Number(l.haber) || 0), 0);
        const ok = td > 0 && Math.round(td * 100) === Math.round(th * 100);
        document.getElementById('ct-n-td').textContent = money(td);
        document.getElementById('ct-n-th').textContent = money(th);
        document.getElementById('ct-n-cuadre').innerHTML = ok ? '<span class="ok-txt">Cuadrado</span>' : `<span class="mal-txt">Diferencia ${money(td - th)}</span>`;
    },

    async guardarNuevo() {
        try {
            const r = (await api.post('/contabilidad/asiento', {
                SedeID: this.getSedeId(), fecha: document.getElementById('ct-n-fecha').value, referencia: document.getElementById('ct-n-ref').value,
                glosa: document.getElementById('ct-n-glosa').value, apertura: document.getElementById('ct-n-apertura').checked,
                lineas: this.lineasNuevo.filter(l => l.cuentaId).map(l => ({ cuentaId: l.cuentaId, debe: l.debe, haber: l.haber, centroCostoId: l.centroCostoId || null })),
            })).data;
            document.getElementById('ct-nuevo').innerHTML = '';
            window.Toast && window.Toast.fire({ icon: 'success', title: `Asiento N° ${r.numero} registrado` });
            this.cargarDiario();
        } catch (e) { Swal.fire('No se registró', errMsg(e), 'error'); }
    },

    // ---------------- LIBRO MAYOR ----------------
    async cargarMayor() {
        const v = id => document.getElementById(id).value;
        let d;
        try { d = (await api.get(`/contabilidad/mayor/${this.getSedeId()}`, { params: { cuentaId: v('ct-m-cuenta'), desde: v('ct-m-desde'), hasta: v('ct-m-hasta') } })).data; }
        catch (e) { return Swal.fire('Error', errMsg(e), 'error'); }
        document.getElementById('ct-mayor').innerHTML = `<p class="ayuda"><b>${esc(d.cuenta.Codigo)} ${esc(d.cuenta.Nombre)}</b> · naturaleza ${d.cuenta.Naturaleza.toLowerCase()}</p>
            <table><thead><tr><th>Fecha</th><th>N°</th><th>Glosa</th><th>Centro</th><th class="num">Debe</th><th class="num">Haber</th><th class="num">Saldo</th></tr></thead><tbody>
            <tr class="grupo"><td colspan="6">Saldo inicial</td><td class="num">${money(d.saldoInicial)}</td></tr>
            ${d.items.map(m => `<tr class="clic" onclick="ContaModule.verAsiento(${m.AsientoID})"><td>${esc(m.Fecha)}</td><td>${m.Numero}</td><td>${esc(m.Glosa)}${m.Detalle ? `<div class="muted">${esc(m.Detalle)}</div>` : ''}</td>
                <td>${esc(m.Centro || '')}</td><td class="num">${cifra(m.Debe)}</td><td class="num">${cifra(m.Haber)}</td><td class="num">${money(m.Saldo)}</td></tr>`).join('')}
            <tr class="total"><td colspan="6">Saldo final</td><td class="num">${money(d.saldoFinal)}</td></tr></tbody></table>`;
    },

    // ---------------- BALANCES ----------------
    subBalance(s) {
        this.sub = s;
        document.querySelectorAll('#seccion-conta [data-sub]').forEach(b => b.classList.toggle('primary', b.dataset.sub === s));
        this.cargarBalance();
    },

    async cargarBalance() {
        const desde = document.getElementById('ct-b-desde').value, hasta = document.getElementById('ct-b-hasta').value;
        const box = document.getElementById('ct-balance');
        box.innerHTML = '<div class="vacio"><i class="fas fa-spinner fa-spin"></i></div>';
        try {
            const sede = this.getSedeId();
            if (this.sub === 'resultados') this.renderResultados((await api.get(`/contabilidad/resultados/${sede}`, { params: { desde, hasta } })).data);
            if (this.sub === 'comprobacion') this.renderComprobacion((await api.get(`/contabilidad/comprobacion/${sede}`, { params: { desde, hasta } })).data);
            if (this.sub === 'general') this.renderGeneral((await api.get(`/contabilidad/balance/${sede}`, { params: { hasta } })).data);
        } catch (e) { box.innerHTML = `<div class="vacio">${esc(errMsg(e))}</div>`; }
    },

    renderResultados(d) {
        const cols = d.centros.filter(c => d.resumen.find(r => r.id === c.id && (r.Ingresos || r.Gastos)));
        const fila = f => `<tr><td>${esc(f.Codigo)} ${esc(f.Nombre)}</td>${cols.map(c => `<td class="num">${cifra(f.centros[c.id])}</td>`).join('')}<td class="num"><b>${money(f.Total)}</b></td></tr>`;
        const tot = (t, campo) => `<tr class="total"><td>${t}</td>${cols.map(c => `<td class="num">${money(d.resumen.find(r => r.id === c.id)[campo])}</td>`).join('')}<td class="num">${money(campo === 'Resultado' ? d.totales.Resultado : d.totales[campo])}</td></tr>`;
        this.ultimoBalance = { titulo: 'resultados', filas: [['Cuenta', ...cols.map(c => c.Codigo), 'Total'], ...d.filas.map(f => [`${f.Codigo} ${f.Nombre}`, ...cols.map(c => f.centros[c.id] || 0), f.Total])] };
        document.getElementById('ct-balance').innerHTML = !d.filas.length ? '<div class="vacio">Sin ingresos ni gastos contabilizados en el período.</div>' : `
            <div class="kpis">
                <div class="kpi"><div class="t">Ingresos</div><div class="v">${money(d.totales.Ingresos)}</div></div>
                <div class="kpi"><div class="t">Costos y gastos</div><div class="v">${money(d.totales.Gastos)}</div></div>
                <div class="kpi"><div class="t">Resultado departamental</div><div class="v">${money(d.totales.ResultadoDepartamental)}</div><div class="muted">centros operativos</div></div>
                <div class="kpi"><div class="t">Utilidad (GOP)</div><div class="v" style="color:${d.totales.GOP >= 0 ? '#1e8449' : '#b03a2e'};">${money(d.totales.GOP)}</div><div class="muted">menos no distribuidos ${money(-d.totales.NoDistribuidos)}</div></div>
            </div>
            <div class="tabla-scroll" style="max-height:600px;"><table><thead><tr><th>Cuenta</th>${cols.map(c => `<th class="num" title="${esc(c.Nombre)}">${esc(c.Codigo)}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>
            <tr class="grupo"><td colspan="${cols.length + 2}">INGRESOS</td></tr>${d.filas.filter(f => f.Tipo === 'INGRESO').map(fila).join('')}${tot('Total ingresos', 'Ingresos')}
            <tr class="grupo"><td colspan="${cols.length + 2}">COSTOS Y GASTOS</td></tr>${d.filas.filter(f => f.Tipo === 'GASTO').map(fila).join('')}${tot('Total costos y gastos', 'Gastos')}
            ${tot('RESULTADO', 'Resultado')}</tbody></table></div>`;
    },

    renderComprobacion(d) {
        this.ultimoBalance = { titulo: 'comprobacion', filas: [['Código', 'Cuenta', 'Saldo inicial', 'Debe', 'Haber', 'Saldo final'], ...d.filas.map(f => [f.Codigo, f.Nombre, f.SaldoInicial, f.Debe, f.Haber, f.SaldoFinal])] };
        document.getElementById('ct-balance').innerHTML = `<p class="ayuda">${d.totales.cuadra ? '<span class="ok-txt"><i class="fas fa-check"></i> Debe = Haber</span>' : '<span class="mal-txt">No cuadra</span>'} · saldos deudores en positivo, acreedores en negativo.</p>
            <div class="tabla-scroll" style="max-height:600px;"><table><thead><tr><th>Cuenta</th><th class="num">Saldo inicial</th><th class="num">Debe</th><th class="num">Haber</th><th class="num">Saldo final</th></tr></thead><tbody>
            ${d.filas.map(f => `<tr><td>${esc(f.Codigo)} ${esc(f.Nombre)}</td><td class="num">${money(f.SaldoInicial)}</td><td class="num">${cifra(f.Debe)}</td><td class="num">${cifra(f.Haber)}</td><td class="num">${money(f.SaldoFinal)}</td></tr>`).join('')}
            <tr class="total"><td>Totales</td><td></td><td class="num">${money(d.totales.Debe)}</td><td class="num">${money(d.totales.Haber)}</td><td></td></tr></tbody></table></div>`;
    },

    renderGeneral(d) {
        const bloque = (t, arr, total) => `<tr class="grupo"><td colspan="2">${t}</td></tr>${arr.map(x => `<tr><td>${esc(x.Codigo)} ${esc(x.Nombre)}</td><td class="num">${money(x.Saldo)}</td></tr>`).join('')}<tr class="total"><td>Total ${t.toLowerCase()}</td><td class="num">${money(total)}</td></tr>`;
        this.ultimoBalance = { titulo: 'balance_general', filas: [['Código', 'Cuenta', 'Saldo'], ...['ACTIVO', 'PASIVO', 'PATRIMONIO'].flatMap(g => d.grupos[g].map(x => [x.Codigo, x.Nombre, x.Saldo])), ['', 'Resultado del ejercicio', d.resultado]] };
        document.getElementById('ct-balance').innerHTML = `<p class="ayuda">Al ${esc(d.hasta.split('-').reverse().join('/'))} · ${d.totales.cuadra ? '<span class="ok-txt"><i class="fas fa-check"></i> Activo = Pasivo + Patrimonio</span>' : '<span class="mal-txt">No cuadra</span>'}</p>
            <div class="grid-receta" style="grid-template-columns:1fr 1fr;">
                <table><tbody>${bloque('ACTIVO', d.grupos.ACTIVO, d.totales.Activo)}</tbody></table>
                <table><tbody>${bloque('PASIVO', d.grupos.PASIVO, d.totales.Pasivo)}${bloque('PATRIMONIO', d.grupos.PATRIMONIO, d.totales.Patrimonio)}
                    <tr><td>Resultado del ejercicio (no cerrado)</td><td class="num">${money(d.resultado)}</td></tr>
                    <tr class="total"><td>Total pasivo + patrimonio</td><td class="num">${money(d.totales.PasivoPatrimonio)}</td></tr></tbody></table>
            </div>`;
    },

    csv() {
        if (!this.ultimoBalance) return;
        const txt = '﻿' + this.ultimoBalance.filas.map(f => f.map(c => typeof c === 'number' ? c.toFixed(2).replace('.', ',') : `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
        a.download = `${this.ultimoBalance.titulo}_${hoyISO()}.csv`; a.click();
    },

    // ---------------- PLAN DE CUENTAS ----------------
    renderPlan() {
        document.getElementById('ct-plan').innerHTML = `<table><thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th>Naturaleza</th><th></th></tr></thead><tbody>
            ${this.cuentas.map(c => `<tr class="${c.EsMovimiento ? '' : 'grupo'}" style="${c.Estado ? '' : 'opacity:.45;'}">
                <td style="padding-left:${(c.Nivel - 1) * 14 + 6}px;">${esc(c.Codigo)}</td><td>${esc(c.Nombre)}</td>
                <td class="muted">${c.Tipo}</td><td class="muted">${c.Naturaleza.toLowerCase()}</td>
                <td style="white-space:nowrap;">${c.EsMovimiento ? `<button class="cc-btn mini" title="Renombrar" onclick="ContaModule.renombrar(${c.CuentaID})"><i class="fas fa-pen"></i></button>
                    <button class="cc-btn mini" title="${c.Estado ? 'Desactivar' : 'Activar'}" onclick="ContaModule.activar(${c.CuentaID}, ${c.Estado ? 0 : 1})"><i class="fas fa-${c.Estado ? 'eye-slash' : 'eye'}"></i></button>` : ''}</td></tr>`).join('')}</tbody></table>`;
    },

    async crearCuenta() {
        try {
            await api.post('/contabilidad/cuenta', { SedeID: this.getSedeId(), Codigo: document.getElementById('ct-p-codigo').value, Nombre: document.getElementById('ct-p-nombre').value });
            document.getElementById('ct-p-codigo').value = ''; document.getElementById('ct-p-nombre').value = '';
            window.Toast && window.Toast.fire({ icon: 'success', title: 'Cuenta creada' });
            await this.recargar();
        } catch (e) { Swal.fire('No se creó', errMsg(e), 'error'); }
    },

    async renombrar(id) {
        const c = this.cuentas.find(x => x.CuentaID === id);
        const { value } = await Swal.fire({ title: `Cuenta ${c.Codigo}`, input: 'text', inputValue: c.Nombre, showCancelButton: true, confirmButtonText: 'Guardar' });
        if (!value) return;
        try { await api.put(`/contabilidad/cuenta/${id}`, { SedeID: this.getSedeId(), Nombre: value }); await this.recargar(); }
        catch (e) { Swal.fire('No se guardó', errMsg(e), 'error'); }
    },

    async activar(id, estado) {
        try { await api.put(`/contabilidad/cuenta/${id}`, { SedeID: this.getSedeId(), Estado: estado }); await this.recargar(); }
        catch (e) { Swal.fire('No se cambió', errMsg(e), 'error'); }
    },

    // ---------------- CUENTAS AUTOMÁTICAS ----------------
    async cargarMapeo() {
        let d;
        try { d = (await api.get(`/contabilidad/mapeo/${this.getSedeId()}`)).data; }
        catch (e) { return Swal.fire('Error', errMsg(e), 'error'); }
        document.getElementById('ct-claves').innerHTML = `<table><thead><tr><th>Para qué</th><th>Cuenta</th></tr></thead><tbody>
            ${d.claves.map(k => `<tr><td><b>${esc(CLAVES[k.Clave] || k.Clave)}</b><div class="muted">${esc(k.Descripcion || '')}</div></td>
                <td><select style="width:100%;" onchange="ContaModule.guardarClave('${k.Clave}', this.value)">${this.opcionesCuenta(k.CuentaID)}</select></td></tr>`).join('')}</tbody></table>`;
        const trat = { GASTO: 'gasto', INVENTARIO: 'compra a inventario', NO_GASTO: 'no es gasto' };
        document.getElementById('ct-rubros').innerHTML = `<table><thead><tr><th>Rubro</th><th>Tipo</th><th class="num">Movs.</th><th>Cuenta contable</th></tr></thead><tbody>
            ${d.rubros.map(r => `<tr><td><b>${esc(r.Nombre)}</b><div class="muted">${r.CentroCostoCodigo ? `centro ${esc(r.CentroCostoCodigo)} · ` : ''}${trat[r.Tratamiento] || ''}</div></td>
                <td>${esc(r.Tipo)}</td><td class="num">${r.Movimientos}</td>
                <td><select style="width:100%;" onchange="ContaModule.cuentaRubro(${r.RubroID}, this.value)">${this.opcionesCuenta(r.CuentaContableID, '(automática)')}</select></td></tr>`).join('')}</tbody></table>`;
    },

    async guardarClave(clave, cuentaId) {
        try { await api.put('/contabilidad/mapeo', { SedeID: this.getSedeId(), Clave: clave, CuentaID: cuentaId }); window.Toast && window.Toast.fire({ icon: 'success', title: 'Cuenta asignada' }); }
        catch (e) { Swal.fire('No se guardó', errMsg(e), 'error'); this.cargarMapeo(); }
    },

    async cuentaRubro(rubroId, cuentaId) {
        try { await api.put(`/contabilidad/rubro/${rubroId}/cuenta`, { SedeID: this.getSedeId(), CuentaID: cuentaId || null }); window.Toast && window.Toast.fire({ icon: 'success', title: 'Cuenta del rubro guardada' }); }
        catch (e) { Swal.fire('No se guardó', errMsg(e), 'error'); this.cargarMapeo(); }
    },

    // ---------------- PERIODOS ----------------
    async cargarPeriodos() {
        let items = [];
        try { items = (await api.get(`/contabilidad/periodos/${this.getSedeId()}`)).data.items; }
        catch (e) { return Swal.fire('Error', errMsg(e), 'error'); }
        document.getElementById('ct-periodos').innerHTML = !items.length ? '<div class="vacio">Ningún mes cerrado todavía.</div>' : `<table><thead><tr><th>Periodo</th><th>Estado</th><th>Cierre</th><th>Reapertura</th><th></th></tr></thead><tbody>
            ${items.map(p => `<tr><td><b>${MESES[p.Mes - 1]} ${p.Anio}</b></td>
                <td><span class="badge ${p.Estado === 'CERRADO' ? 'b-ok' : 'b-medio'}">${p.Estado}</span></td>
                <td class="muted">${esc(p.FechaCierre)} · ${esc(p.NombreUsuario || '')}${p.Observacion ? `<div>${esc(p.Observacion)}</div>` : ''}</td>
                <td class="muted">${p.FechaReapertura ? `${esc(p.FechaReapertura)} · ${esc(p.ReabiertoPor || '')}<div>${esc(p.MotivoReapertura || '')}</div>` : ''}</td>
                <td>${p.Estado === 'CERRADO' ? `<button class="cc-btn mini" onclick="ContaModule.reabrir(${p.Anio}, ${p.Mes})"><i class="fas fa-lock-open"></i> Reabrir</button>`
                    : `<button class="cc-btn mini danger" onclick="ContaModule.cerrarPeriodo(${p.Anio}, ${p.Mes})"><i class="fas fa-lock"></i> Cerrar</button>`}</td></tr>`).join('')}</tbody></table>`;
    },

    async cerrarPeriodo(anio, mes) {
        anio = anio || parseInt(document.getElementById('ct-per-anio').value);
        mes = mes || parseInt(document.getElementById('ct-per-mes').value);
        const ok = await Swal.fire({ title: `¿Cerrar ${MESES[mes - 1]} ${anio}?`, icon: 'warning', showCancelButton: true, confirmButtonText: 'Cerrar periodo',
            input: 'text', inputPlaceholder: 'Observación (opcional)',
            html: 'Se contabiliza todo lo pendiente del mes y queda congelado. Nadie podrá borrar movimientos de caja de ese mes.' });
        if (!ok.isConfirmed) return;
        try {
            await api.post('/contabilidad/periodo/cerrar', { SedeID: this.getSedeId(), anio, mes, observacion: ok.value || null });
            window.Toast && window.Toast.fire({ icon: 'success', title: `${MESES[mes - 1]} ${anio} cerrado` });
            this.cargarPeriodos();
        } catch (e) { Swal.fire('No se cerró', errMsg(e), 'error'); }
    },

    async reabrir(anio, mes) {
        const { value: motivo } = await Swal.fire({ title: `Reabrir ${MESES[mes - 1]} ${anio}`, input: 'text', inputPlaceholder: 'Motivo (queda auditado)',
            showCancelButton: true, confirmButtonText: 'Reabrir', inputValidator: v => (!v || v.trim().length < 10) && 'Explique el motivo (mínimo 10 caracteres)' });
        if (!motivo) return;
        try { await api.post('/contabilidad/periodo/reabrir', { SedeID: this.getSedeId(), anio, mes, motivo }); this.cargarPeriodos(); }
        catch (e) { Swal.fire('No se reabrió', errMsg(e), 'error'); }
    },

    destroy() {},
};

module.exports = ContaModule;
