// costohab.js — Costo por habitación ocupada (Fase 3)
// Kit de amenities/lavandería por tipo de habitación, limpiezas de salida con su
// costo real, reparto de gastos fijos y el informe CPOR frente al ingreso por
// ocupación. Todo el cálculo lo hace el backend (/api/costo-habitacion).
const api = require('./api');
const Unidades = require('./unidades');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, d = 2) => n == null ? '—' : '$' + (parseFloat(n) || 0).toLocaleString('es-EC', { minimumFractionDigits: d, maximumFractionDigits: d });
const num = (n, d = 1) => (Number(n) || 0).toLocaleString('es-EC', { maximumFractionDigits: d });
const pct = n => n == null || !isFinite(n) ? '—' : `${Number(n).toFixed(1)}%`;
const hoyISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const errMsg = e => (e && e.response && e.response.data && (e.response.data.error || e.response.data.message)) || (e && e.message) || 'Error';
const TRATAMIENTOS = { GASTO: 'Gasto', INVENTARIO: 'Compra a inventario', NO_GASTO: 'No es gasto' };
const CENTROS = { HAB: 'Habitaciones', AYB: 'Alimentos y bebidas', EVE: 'Eventos', PAR: 'Parqueadero', ADM: 'Administración', VYM: 'Ventas y marketing', MAN: 'Mantenimiento', SER: 'Servicios' };

const CostoHabModule = {
    productos: [],
    tipos: [],
    tipoSel: null,
    lineas: [],
    datos: null,

    async init() {
        window.CostoHabModule = this;
        window.backView = 'dashboard';
        const ini = hoyISO().slice(0, 8) + '01';
        for (const p of ['ch', 'ch-lim']) {
            document.getElementById(`${p}-desde`).value = ini;
            document.getElementById(`${p}-hasta`).value = hoyISO();
        }
        App.renderSedeSelector('sedeSelectorCostoHab', () => this.recargar());
        await this.recargar();
    },

    getSedeId() {
        const sel = document.getElementById('globalSedeSelector');
        return sel ? sel.value : (localStorage.getItem('currentSedeId') || App.user.SedeID);
    },

    tab(nombre) {
        document.querySelectorAll('#seccion-costohab .cc-tab').forEach(b => b.classList.toggle('activa', b.dataset.tab === nombre));
        document.querySelectorAll('#seccion-costohab .cc-tabpanel').forEach(p => p.style.display = p.dataset.panel === nombre ? '' : 'none');
        if (nombre === 'kits') this.cargarKits();
        if (nombre === 'limpiezas') this.cargarLimpiezas();
        if (nombre === 'gastos') this.renderRubros();
    },

    async recargar() {
        this.tipoSel = null;
        try {
            const p = await api.get(`/inventario/sede/${this.getSedeId()}`);
            this.productos = (p.data || []).filter(x => x.EsPlatoReceta != 1);
        } catch (e) { this.productos = []; }
        await this.cargarCpor();
        const activa = document.querySelector('#seccion-costohab .cc-tab.activa');
        if (activa && activa.dataset.tab !== 'cpor') this.tab(activa.dataset.tab);
    },

    // ---------------- CPOR ----------------
    async cargarCpor() {
        const desde = document.getElementById('ch-desde').value, hasta = document.getElementById('ch-hasta').value;
        try {
            const r = await api.get(`/costo-habitacion/cpor/${this.getSedeId()}`, { params: { desde, hasta } });
            this.datos = r.data;
        } catch (e) { return Swal.fire('Error', errMsg(e), 'error'); }
        const d = this.datos, s = d.resumen, c = d.componentes, p = d.parametros;
        document.getElementById('ch-cfg-factor').value = String(p.factorMomento);
        document.getElementById('ch-cfg-prorrateo').value = p.prorrateo;

        document.getElementById('ch-explica').innerHTML =
            `Una <b>ocupación</b> = una noche vendida${s.momentos ? ` (cada alquiler por momento cuenta como ${num(p.factorMomento, 2)})` : ''}. ` +
            `Ingresos ${p.ivaIncluido ? `sin IVA (${num(p.ivaPct)}%)` : 'tal como se registran'}, de las estadías que entraron en el período.`;
        const margenColor = s.margenPorOcupacion == null ? '' : (s.margenPorOcupacion >= 0 ? 'color:#1e8449;' : 'color:#b03a2e;');
        // Con egresos sin centro de costo el costo está subestimado: se avisa en la misma cifra.
        const incompleto = c.sinCentro > 0 ? ' <span class="badge b-medio" title="Hay egresos sin centro de costo fuera del cálculo">INCOMPLETO</span>' : '';
        document.getElementById('ch-kpis').innerHTML = [
            ['Ocupaciones', `${num(s.ocupaciones)}`, `${s.noches} noches · ${s.momentos} momentos`],
            ['CPOR · costo por ocupación', money(s.cpor) + incompleto, `costo total ${money(s.costoTotal)}`],
            ['Ingreso por ocupación', money(s.ingresoPorOcupacion), `ingreso neto ${money(s.ingresoNeto)}`],
            ['Margen por ocupación', `<span style="${margenColor}">${money(s.margenPorOcupacion)}</span>` + incompleto, `margen ${pct(s.margenPct)}`],
            ['ADR (estadías)', money(s.adr), s.ingresoPorMomento != null ? `momento promedio ${money(s.ingresoPorMomento)}` : 'tarifa media por noche'],
        ].map(([t, v, sub]) => `<div class="kpi"><div class="t">${t}</div><div class="v">${v}</div><div class="muted">${sub}</div></div>`).join('');

        const alertas = [];
        if (c.sinCentro > 0) alertas.push(`Hay ${money(c.sinCentro)} en egresos <b>sin centro de costo</b> que no entran en este cálculo. Clasifíquelos en Configuración → Centros de costo.`);
        if (c.kitsFaltantes > 0) alertas.push(`${money(c.kitsFaltantes)} del costo de kits es <b>estimado</b>: en el sistema faltaba stock de algún amenity al limpiar. Revise ese inventario.`);
        if (!this.datos.habitaciones.some(h => h.Kits > 0)) alertas.push('Todavía no hay limpiezas con kit en este período. Configure el kit de cada tipo en la pestaña <b>Kit por tipo</b>.');
        document.getElementById('ch-alertas').innerHTML = alertas.map(a => `<p class="ayuda" style="background:#fdebd0; color:#7e5109; padding:10px 12px; border-radius:12px; margin:8px 0 0;"><i class="fas fa-triangle-exclamation"></i> ${a}</p>`).join('');

        const fila = (t, v, nota = '') => `<tr><td>${t}</td><td class="num">${money(v)}</td><td class="muted">${nota}</td></tr>`;
        document.getElementById('ch-componentes').innerHTML = `<table><thead><tr><th>Componente</th><th class="num">Monto</th><th></th></tr></thead><tbody>
            ${fila('Kits de limpieza (amenities, lavandería)', c.kits, c.kitsFaltantes ? `incluye ${money(c.kitsFaltantes)} estimado` : 'costo real del kardex')}
            ${fila('Materiales de mantenimiento en habitaciones', c.materialesHabitaciones, 'salidas del inventario enlazadas a la orden')}
            ${fila('Gastos del centro Habitaciones', c.fijosHabitaciones, 'nómina de pisos, lavandería externa, otros (rubros tratados como gasto)')}
            ${fila('Parte de gastos no distribuidos', c.prorrateo, p.prorrateo === 'INGRESOS'
                ? `${pct(c.participacionHab * 100)} de ${money(c.noDistribuidos)} (participación de habitaciones en los ingresos)` : 'no se reparten (configurable)')}
            <tr><td><b>Costo total de habitaciones</b></td><td class="num"><b>${money(s.costoTotal)}</b></td><td></td></tr>
            ${c.excluidos.INVENTARIO ? fila('<span class="muted">Fuera del costo: compras a inventario</span>', c.excluidos.INVENTARIO, 'se cuestan al consumirse') : ''}
            ${c.excluidos.NO_GASTO ? fila('<span class="muted">Fuera del costo: no es gasto</span>', c.excluidos.NO_GASTO, 'retiros, préstamos, traspasos') : ''}
        </tbody></table>`;

        const cab = primera => `<thead><tr><th>${primera}</th><th class="num">Noches</th><th class="num">Momentos</th><th class="num">Ingreso neto</th>
            <th class="num">Kits</th><th class="num">Mant.</th><th class="num">Fijos</th><th class="num">CPOR</th><th class="num">Ingreso/ocup.</th><th class="num">Margen</th></tr></thead>`;
        const celdas = h => `<td class="num">${h.Noches}</td><td class="num">${h.Momentos}</td><td class="num">${money(h.IngresoNeto)}</td>
            <td class="num">${money(h.Kits)}</td><td class="num">${money(h.Materiales)}</td><td class="num">${money(h.Fijos)}</td>
            <td class="num"><b>${money(h.CPOR)}</b></td><td class="num">${money(h.IngresoPorOcupacion)}</td>
            <td class="num">${h.MargenPct == null ? (h.CostoTotal > 0 ? `<span class="badge b-alto">${money(-h.CostoTotal)}</span>` : '—')
                : `<span class="badge ${h.MargenPct >= 40 ? 'b-ok' : h.MargenPct >= 15 ? 'b-medio' : 'b-alto'}">${pct(h.MargenPct)}</span>`}</td>`;
        document.getElementById('ch-tipos').innerHTML = d.porTipo.length
            ? `<table>${cab('Tipo')}<tbody>${d.porTipo.map(t => `<tr><td><b>${esc(t.TipoNombre)}</b> <span class="muted">${t.Habitaciones} hab.</span></td>${celdas(t)}</tr>`).join('')}</tbody></table>`
            : '<div class="vacio">Sin habitaciones.</div>';
        document.getElementById('ch-habs').innerHTML = d.habitaciones.length
            ? `<table>${cab('Habitación')}<tbody>${d.habitaciones.map(h => `<tr><td><b>${esc(h.NroHabitacion)}</b> <span class="muted">${esc(h.TipoNombre)}${h.Ordenes ? ` · <i class="fas fa-screwdriver-wrench"></i> ${h.Ordenes} orden(es)${h.ManoObra ? `, mano de obra ${money(h.ManoObra)}` : ''}` : ''}</span></td>${celdas(h)}</tr>`).join('')}</tbody></table>`
            : '<div class="vacio">Sin habitaciones.</div>';
        if (document.querySelector('#seccion-costohab .cc-tab.activa')?.dataset.tab === 'gastos') this.renderRubros();
    },

    // ---------------- KITS ----------------
    async cargarKits() {
        try {
            const r = await api.get(`/costo-habitacion/kits/${this.getSedeId()}`);
            this.tipos = r.data.tipos || [];
        } catch (e) { return Swal.fire('Error', errMsg(e), 'error'); }
        document.getElementById('ch-kit-tipos').innerHTML = this.tipos.length ? this.tipos.map(t => `
            <div class="lista-item ${this.tipoSel === t.TipoID ? 'sel' : ''}" onclick="CostoHabModule.abrirKit(${t.TipoID})">
                <div><b>${esc(t.Descripcion)}</b><div class="muted">${t.Habitaciones} habitación(es) · ${t.lineas.length} línea(s)</div></div>
                <div style="text-align:right;">${t.lineas.length ? `<b>${money(t.costoSalidaEstadia)}</b><div class="muted">+ ${money(t.costoNoche)}/noche</div>` : '<span class="badge b-gris">SIN KIT</span>'}</div>
            </div>`).join('') : '<div class="vacio">No hay tipos de habitación en esta sede.</div>';
        if (this.tipoSel) this.abrirKit(this.tipoSel); else document.getElementById('ch-kit-editor').innerHTML = '<div class="vacio">Elija un tipo de habitación para armar su kit.</div>';
    },

    abrirKit(tipoId) {
        const t = this.tipos.find(x => x.TipoID === tipoId);
        if (!t) return;
        this.tipoSel = tipoId;
        document.querySelectorAll('#ch-kit-tipos .lista-item').forEach((el, i) => el.classList.toggle('sel', this.tipos[i].TipoID === tipoId));
        this.lineas = t.lineas.map(l => ({
            modo: l.ProductoID ? 'P' : 'C', ProductoID: l.ProductoID, Concepto: l.Concepto || '', Cantidad: Number(l.Cantidad),
            Unidad: l.UnidadBase || 'UND', CostoFijo: l.CostoFijo, Frecuencia: l.Frecuencia, AplicaA: l.AplicaA,
        }));
        if (!this.lineas.length) this.lineas.push(this.lineaNueva('P'));
        this.renderKit();
    },

    lineaNueva(modo) {
        return { modo, ProductoID: null, Concepto: modo === 'C' ? 'Lavandería (juego de sábanas y toallas)' : '', Cantidad: 1, Unidad: 'UND', CostoFijo: '', Frecuencia: 'POR_SALIDA', AplicaA: 'TODOS' };
    },

    renderKit() {
        const t = this.tipos.find(x => x.TipoID === this.tipoSel);
        const prods = this.productos;
        const optProd = sel => '<option value="">— Elegir insumo —</option>' + prods.map(p =>
            `<option value="${p.ProductoID}" ${p.ProductoID === sel ? 'selected' : ''}>${esc(p.Nombre)} · ${Unidades.fmt(p.StockReal ?? p.StockActual, p.UnidadBase)}</option>`).join('');
        const sel = (v, opts) => opts.map(([k, txt]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${txt}</option>`).join('');
        const filas = this.lineas.map((l, i) => {
            const p = this.productos.find(x => x.ProductoID === l.ProductoID);
            const queEs = l.modo === 'P'
                ? `<select style="width:100%;" onchange="CostoHabModule.setLinea(${i}, 'ProductoID', this.value)">${optProd(l.ProductoID)}</select>`
                : `<input type="text" style="width:100%;" value="${esc(l.Concepto)}" placeholder="Concepto (p. ej. lavandería)" oninput="CostoHabModule.setLinea(${i}, 'Concepto', this.value, true)">`;
            const unidad = l.modo === 'P'
                ? `<select onchange="CostoHabModule.setLinea(${i}, 'Unidad', this.value)">${Unidades.opciones(p ? p.UnidadBase : 'UND', l.Unidad)}</select>`
                : `<input type="number" step="0.01" min="0" style="width:90px;" value="${l.CostoFijo ?? ''}" placeholder="$ c/u" oninput="CostoHabModule.setLinea(${i}, 'CostoFijo', this.value, true)">`;
            return `<tr>
                <td>${l.modo === 'P' ? '<i class="fas fa-box" title="Del inventario"></i>' : '<i class="fas fa-hand-holding-dollar" title="Costo fijo"></i>'}</td>
                <td style="min-width:220px;">${queEs}</td>
                <td><input type="number" step="0.001" min="0" style="width:80px;" value="${l.Cantidad}" oninput="CostoHabModule.setLinea(${i}, 'Cantidad', this.value, true)"></td>
                <td>${unidad}</td>
                <td><select onchange="CostoHabModule.setLinea(${i}, 'Frecuencia', this.value)">${sel(l.Frecuencia, [['POR_SALIDA', 'Por salida'], ['POR_NOCHE', 'Por noche']])}</select></td>
                <td><select onchange="CostoHabModule.setLinea(${i}, 'AplicaA', this.value)">${sel(l.AplicaA, [['TODOS', 'Todo alquiler'], ['ESTADIA', 'Solo estadías'], ['MOMENTO', 'Solo momentos']])}</select></td>
                <td class="num" id="ch-kit-c-${i}"></td>
                <td><button class="cc-btn mini danger" onclick="CostoHabModule.quitarLinea(${i})"><i class="fas fa-xmark"></i></button></td>
            </tr>`;
        }).join('');
        document.getElementById('ch-kit-editor').innerHTML = `
            <h3><i class="fas fa-pump-soap"></i> Kit de "${esc(t.Descripcion)}"</h3>
            <p class="ayuda">Insumos del inventario (salen del stock a su costo promedio) o conceptos con costo fijo, como la lavandería externa por juego. "Por noche" se multiplica por las noches de la estadía (p. ej. papel higiénico, reposición de café).</p>
            <table><thead><tr><th></th><th>Insumo o concepto</th><th>Cant.</th><th>Unidad / costo</th><th>Frecuencia</th><th>Aplica a</th><th class="num">Costo</th><th></th></tr></thead>
                <tbody>${filas}</tbody></table>
            <div class="barra" style="margin-top:12px;">
                <button class="cc-btn" onclick="CostoHabModule.agregarLinea('P')"><i class="fas fa-plus"></i> Insumo del inventario</button>
                <button class="cc-btn" onclick="CostoHabModule.agregarLinea('C')"><i class="fas fa-plus"></i> Concepto con costo fijo</button>
                <button class="cc-btn ok" style="margin-left:auto;" onclick="CostoHabModule.guardarKit()"><i class="fas fa-floppy-disk"></i> Guardar kit</button>
            </div>
            <div class="kpis" id="ch-kit-kpis" style="margin-top:14px;"></div>`;
        this.calcularKit();
    },

    setLinea(i, campo, valor, sinRender) {
        const l = this.lineas[i];
        if (campo === 'ProductoID') {
            l.ProductoID = parseInt(valor) || null;
            const p = this.productos.find(x => x.ProductoID === l.ProductoID);
            l.Unidad = p ? (p.UnidadBase || 'UND') : 'UND';
        } else l[campo] = valor;
        if (sinRender) this.calcularKit(); else this.renderKit();
    },
    agregarLinea(modo) { this.lineas.push(this.lineaNueva(modo)); this.renderKit(); },
    quitarLinea(i) { this.lineas.splice(i, 1); this.renderKit(); },

    costoLinea(l) {
        if (l.modo === 'C') return (Number(l.Cantidad) || 0) * (Number(l.CostoFijo) || 0);
        const p = this.productos.find(x => x.ProductoID === l.ProductoID);
        if (!p) return 0;
        return (Number(l.Cantidad) || 0) * Unidades.factor(p.UnidadBase, l.Unidad) * (Number(p.CostoPromedio ?? p.CostoCompra) || 0);
    },

    calcularKit() {
        let salidaE = 0, salidaM = 0, noche = 0;
        this.lineas.forEach((l, i) => {
            const c = this.costoLinea(l);
            const el = document.getElementById(`ch-kit-c-${i}`); if (el) el.textContent = money(c, 4);
            const aE = l.AplicaA !== 'MOMENTO', aM = l.AplicaA !== 'ESTADIA';
            if (l.Frecuencia === 'POR_NOCHE') { if (aE) noche += c; }
            else { if (aE) salidaE += c; if (aM) salidaM += c; }
        });
        const k = document.getElementById('ch-kit-kpis');
        if (k) k.innerHTML = [
            ['Por salida (estadía)', money(salidaE, 4)], ['Más por cada noche', money(noche, 4)],
            ['Estadía de 2 noches', money(salidaE + 2 * noche)], ['Por momento', money(salidaM, 4)],
        ].map(([t, v]) => `<div class="kpi"><div class="t">${t}</div><div class="v">${v}</div></div>`).join('');
    },

    async guardarKit() {
        const lineas = this.lineas.filter(l => l.modo === 'P' ? l.ProductoID : String(l.Concepto).trim()).map(l => l.modo === 'P'
            ? { ProductoID: l.ProductoID, Cantidad: l.Cantidad, Unidad: l.Unidad, Frecuencia: l.Frecuencia, AplicaA: l.AplicaA }
            : { Concepto: l.Concepto, Cantidad: l.Cantidad, CostoFijo: l.CostoFijo, Frecuencia: l.Frecuencia, AplicaA: l.AplicaA });
        try {
            await api.put(`/costo-habitacion/kit/${this.tipoSel}`, { lineas });
            window.Toast && window.Toast.fire({ icon: 'success', title: `Kit guardado (${lineas.length} línea(s))` });
            await this.cargarKits();
        } catch (e) { Swal.fire('No se guardó', errMsg(e), 'error'); }
    },

    // ---------------- LIMPIEZAS ----------------
    async cargarLimpiezas() {
        const desde = document.getElementById('ch-lim-desde').value, hasta = document.getElementById('ch-lim-hasta').value;
        let items = [];
        try { items = (await api.get(`/costo-habitacion/limpiezas/${this.getSedeId()}`, { params: { desde, hasta } })).data.items || []; }
        catch (e) { return Swal.fire('Error', errMsg(e), 'error'); }
        const box = document.getElementById('ch-limpiezas');
        if (!items.length) { box.innerHTML = '<div class="vacio">Sin limpiezas registradas en el período.</div>'; return; }
        const total = items.filter(x => x.Estado === 'REGISTRADA').reduce((a, x) => a + Number(x.CostoTotal), 0);
        box.innerHTML = `<p class="ayuda">${items.length} limpieza(s) · costo ${money(total)}</p>
            <table><thead><tr><th>Fecha</th><th>Hab.</th><th>Tipo</th><th>Folio</th><th class="num">Noches</th><th>Por</th><th class="num">Costo</th><th>Estado</th><th></th></tr></thead><tbody>
            ${items.map(l => `<tr style="${l.Estado === 'ANULADA' ? 'opacity:.55;' : ''}">
                <td>${esc(l.FechaFmt)}</td><td><b>${esc(l.NroHabitacion)}</b> <span class="muted">${esc(l.TipoNombre || '')}</span></td>
                <td><span class="badge ${l.Tipo === 'SALIDA' ? 'b-ok' : 'b-gris'}">${l.Tipo}</span>${l.TipoAlquiler ? ` <span class="muted">${esc(l.TipoAlquiler)}</span>` : ''}</td>
                <td>${l.RecepcionID ? '#' + l.RecepcionID : '—'}</td><td class="num">${l.Noches}</td><td>${esc(l.NombreUsuario || '')}</td>
                <td class="num">${money(l.CostoTotal)}${l.Faltantes ? ` <span class="badge b-medio" title="Sin stock en el sistema: costo estimado">${l.Faltantes} FALTANTE</span>` : ''}</td>
                <td>${l.Estado === 'ANULADA' ? `<span class="badge b-alto" title="${esc(l.MotivoAnulacion)} — ${esc(l.AnuladaPor)}">ANULADA</span>` : ''}</td>
                <td style="white-space:nowrap;">
                    ${l.Tipo === 'SALIDA' ? `<button class="cc-btn mini" onclick="CostoHabModule.verLimpieza(${l.LimpiezaID}, '${esc(l.NroHabitacion)}')"><i class="fas fa-eye"></i></button>` : ''}
                    ${l.Estado === 'REGISTRADA' && l.Tipo === 'SALIDA' ? `<button class="cc-btn mini danger" onclick="CostoHabModule.anularLimpieza(${l.LimpiezaID})" title="Anular y devolver al stock"><i class="fas fa-ban"></i></button>` : ''}
                </td></tr>`).join('')}</tbody></table>`;
    },

    async verLimpieza(id, nro) {
        try {
            const items = (await api.get(`/costo-habitacion/limpieza/${id}`)).data.items || [];
            Swal.fire({
                title: `Limpieza #${id} · hab. ${nro}`, width: 640,
                html: `<table style="width:100%; font-size:.85rem; border-collapse:collapse;"><tr style="text-align:left;"><th>Concepto</th><th style="text-align:right;">Cantidad</th><th style="text-align:right;">Costo</th></tr>
                    ${items.map(d => `<tr><td>${esc(d.Concepto)}${d.Faltante ? ' <b style="color:#b9770e;">(faltante)</b>' : ''}</td>
                        <td style="text-align:right;">${d.ProductoID ? Unidades.fmt(d.Cantidad, d.UnidadBase) : num(d.Cantidad, 3)}</td>
                        <td style="text-align:right;">${money(d.CostoTotal, 4)}</td></tr>`).join('')}</table>`,
            });
        } catch (e) { Swal.fire('Error', errMsg(e), 'error'); }
    },

    async anularLimpieza(id) {
        const { value: motivo } = await Swal.fire({
            title: `Anular limpieza #${id}`, input: 'text', inputPlaceholder: 'Motivo',
            text: 'Los amenities que salieron vuelven al stock a su costo original. Queda registrado quién y por qué.',
            showCancelButton: true, confirmButtonText: 'Anular', inputValidator: v => (!v || v.trim().length < 5) && 'Escriba el motivo',
        });
        if (!motivo) return;
        try {
            const r = await api.post(`/costo-habitacion/limpieza/${id}/anular`, { motivo, SedeID: this.getSedeId() });
            window.Toast && window.Toast.fire({ icon: 'success', title: `Limpieza anulada · ${r.data.devueltos} insumo(s) devueltos` });
            this.cargarLimpiezas();
        } catch (e) { Swal.fire('No se anuló', errMsg(e), 'error'); }
    },

    // ---------------- GASTOS Y REPARTO ----------------
    renderRubros() {
        const box = document.getElementById('ch-rubros');
        const eg = this.datos ? this.datos.egresos : [];
        if (!eg.length) { box.innerHTML = '<div class="vacio">Sin egresos en el período.</div>'; return; }
        box.innerHTML = `<table><thead><tr><th>Centro</th><th>Rubro</th><th class="num">Movs.</th><th class="num">Monto</th><th>Tratamiento</th></tr></thead><tbody>
            ${eg.map(e => `<tr>
                <td>${e.Centro ? `<b>${esc(e.Centro)}</b> <span class="muted">${esc(CENTROS[e.Centro] || e.CentroNombre || '')}</span>` : '<span class="badge b-medio">SIN CENTRO</span>'}</td>
                <td>${esc(e.Rubro)}</td><td class="num">${e.Movimientos}</td><td class="num">${money(e.Monto)}</td>
                <td>${e.RubroID ? `<select onchange="CostoHabModule.tratamiento(${e.RubroID}, this.value, this)">${Object.entries(TRATAMIENTOS).map(([k, t]) => `<option value="${k}" ${k === e.Tratamiento ? 'selected' : ''}>${t}</option>`).join('')}</select>` : '<span class="muted">Gasto</span>'}</td>
            </tr>`).join('')}</tbody></table>`;
    },

    async tratamiento(rubroId, valor, el) {
        try {
            await api.put(`/costo-habitacion/rubro/${rubroId}/tratamiento`, { tratamiento: valor, SedeID: this.getSedeId() });
            window.Toast && window.Toast.fire({ icon: 'success', title: `Rubro: ${TRATAMIENTOS[valor]}` });
            await this.cargarCpor();
        } catch (e) { Swal.fire('No se cambió', errMsg(e), 'error'); this.renderRubros(); }
    },

    async guardarConfig() {
        try {
            await api.put('/config-sede/parametros', { SedeID: this.getSedeId(), config: {
                CPOR_FACTOR_MOMENTO: document.getElementById('ch-cfg-factor').value,
                CPOR_PRORRATEO: document.getElementById('ch-cfg-prorrateo').value,
            } });
            window.Toast && window.Toast.fire({ icon: 'success', title: 'Parámetros guardados' });
            await this.cargarCpor();
        } catch (e) { Swal.fire('No se guardó', errMsg(e), 'error'); }
    },

    destroy() {},
};

module.exports = CostoHabModule;
