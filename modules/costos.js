// costos.js — Cocina y Costos (Fase 2)
// Recetas por gramos con merma, ingresos de compra con costo (promedio ponderado),
// producción de preparaciones, mermas, food cost por producto, inventario
// valorizado y kardex. Todo el cálculo de stock/costo lo hace el backend (/api/costos).
const api = require('./api');
const Unidades = require('./unidades');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, d = 2) => '$' + (parseFloat(n) || 0).toLocaleString('es-EC', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = n => n == null || !isFinite(n) ? '—' : `${Number(n).toFixed(1)}%`;
const hoyISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const errMsg = e => (e && e.response && e.response.data && (e.response.data.error || e.response.data.message)) || (e && e.message) || 'Error';
const TIPOS_MOV = {
    INGRESO: 'Ingreso', AJUSTE_POSITIVO: 'Ajuste +', SALIDA: 'Salida', AJUSTE_NEGATIVO: 'Ajuste −', MERMA: 'Merma',
    DEVOLUCION: 'Devolución', PRODUCCION: 'Producción', PRODUCCION_CONSUMO: 'Consumo producción', ANULA_PRODUCCION: 'Anula producción',
    CONSUMO_HAB: 'Kit de habitación', CONSUMO_MANT: 'Mantenimiento', CONSUMO_EVE: 'Evento',
};

const CostosModule = {
    productos: [],
    recetas: [],
    config: {},
    recetaSel: null,      // { cab, lineas }
    valorizado: [],
    lineasIngreso: [],

    async init() {
        window.CostosModule = this;
        window.backView = 'inventario';
        const ini = hoyISO().slice(0, 8) + '01';
        for (const p of ['prd', 'mer', 'fc', 'kdx']) {
            document.getElementById(`cc-${p}-desde`).value = ini;
            document.getElementById(`cc-${p}-hasta`).value = hoyISO();
        }
        App.renderSedeSelector('sedeSelectorCostos', () => this.recargar());
        await this.recargar();

        // Llegada directa desde la tarjeta de inventario (botón RECETA o KARDEX)
        const abrir = window.__costosAbrir; window.__costosAbrir = null;
        if (abrir && abrir.tipo === 'receta') this.abrirReceta(abrir.id);
        if (abrir && abrir.tipo === 'kardex') this.verKardex(abrir.id);
    },

    getSedeId() {
        const sel = document.getElementById('globalSedeSelector');
        return sel ? sel.value : (localStorage.getItem('currentSedeId') || App.user.SedeID);
    },
    esAdmin() { return require('./permisos').puede('costos', 3); },   // permiso "Total" (anular producciones)
    prod(id) { return this.productos.find(p => p.ProductoID === parseInt(id)); },

    tab(nombre) {
        document.querySelectorAll('#seccion-costos .cc-tab').forEach(b => b.classList.toggle('activa', b.dataset.tab === nombre));
        document.querySelectorAll('#seccion-costos .cc-tabpanel').forEach(p => p.style.display = p.dataset.panel === nombre ? '' : 'none');
        if (nombre === 'produccion') this.cargarProducciones();
        if (nombre === 'mermas') this.cargarMermas();
        if (nombre === 'foodcost') this.cargarFoodCost();
        if (nombre === 'valorizado') this.cargarValorizado();
        if (nombre === 'ingreso' && this.lineasIngreso.length === 0) this.agregarLineaIngreso();
    },

    async recargar() {
        const sedeId = this.getSedeId();
        try {
            const [p, r] = await Promise.all([api.get(`/inventario/sede/${sedeId}`), api.get(`/costos/recetas/${sedeId}`)]);
            this.productos = p.data || [];
            this.recetas = r.data.items || [];
            this.config = r.data.config || {};
        } catch (e) { return Swal.fire('Error', errMsg(e), 'error'); }
        this.renderListaRecetas();
        this.llenarSelects();
        this.lineasIngreso = []; this.renderIngreso();
        const cfg = this.config;
        document.getElementById('cc-cfg-meta').value = cfg.FOOD_COST_OBJETIVO_PCT || 30;
        document.getElementById('cc-cfg-iva-incl').value = cfg.PRECIO_INCLUYE_IVA === '0' ? '0' : '1';
        document.getElementById('cc-cfg-iva').value = cfg.IVA_PCT || 15;
        if (this.recetaSel) this.abrirReceta(this.recetaSel.cab.ProductoID);
        try {
            const prov = await api.get('/proveedores');
            document.getElementById('cc-ing-prov').innerHTML = '<option value="">— Sin proveedor —</option>' +
                (prov.data.proveedores || (Array.isArray(prov.data) ? prov.data : [])).filter(x => x.Estado !== false).map(x => `<option value="${x.ProveedorID}">${esc(x.RazonSocial || x.NombreComercial)}</option>`).join('');
        } catch (_) { /* sin módulo de proveedores: se deja sin proveedor */ }
    },

    llenarSelects() {
        const conStock = this.productos.filter(p => p.TipoItem !== 'SERVICIO' && p.EsPlatoReceta != 1);
        const opts = arr => arr.map(p => `<option value="${p.ProductoID}">${esc(p.Nombre)} · ${Unidades.fmt(p.StockReal ?? p.StockActual, p.UnidadBase)}</option>`).join('');
        document.getElementById('cc-mer-prod').innerHTML = opts(conStock);
        document.getElementById('cc-kdx-prod').innerHTML = this.productos.map(p => `<option value="${p.ProductoID}">${esc(p.Nombre)}</option>`).join('');
        const preps = this.productos.filter(p => p.TipoItem === 'PREPARACION');
        document.getElementById('cc-prd-prod').innerHTML = preps.length
            ? preps.map(p => `<option value="${p.ProductoID}">${esc(p.Nombre)}${p.TieneReceta == 1 ? '' : ' (sin receta)'}</option>`).join('')
            : '<option value="">— No hay preparaciones: cree un producto tipo PREPARACIÓN —</option>';
        this.unidadesMerma();
        this.previewProduccion();
    },

    // ================= RECETAS =================
    semaforo(costoPct) {
        const meta = parseFloat(this.config.FOOD_COST_OBJETIVO_PCT) || 30;
        if (costoPct == null || !isFinite(costoPct)) return 'b-gris';
        return costoPct <= meta ? 'b-ok' : costoPct <= meta * 1.2 ? 'b-medio' : 'b-alto';
    },
    precioNeto(precio) {
        const incl = this.config.PRECIO_INCLUYE_IVA !== '0';
        return incl ? Number(precio) / (1 + (parseFloat(this.config.IVA_PCT) || 0) / 100) : Number(precio);
    },

    renderListaRecetas() {
        const q = (document.getElementById('cc-rec-buscar').value || '').toLowerCase();
        const box = document.getElementById('cc-rec-lista');
        const items = this.recetas.filter(r => r.Nombre.toLowerCase().includes(q));
        if (!items.length) { box.innerHTML = '<div class="vacio">Sin platos ni preparaciones. Cree productos de categoría Alimento/Bebida o tipo PREPARACIÓN.</div>'; return; }
        box.innerHTML = items.map(r => {
            const tiene = !!r.RecetaID;
            const fc = tiene && r.TipoItem !== 'PREPARACION' && Number(r.PrecioVenta) > 0 ? Number(r.CostoPorcion) / this.precioNeto(r.PrecioVenta) * 100 : null;
            const sel = this.recetaSel && this.recetaSel.cab.ProductoID === r.ProductoID ? 'sel' : '';
            return `<div class="lista-item ${sel}" onclick="CostosModule.abrirReceta(${r.ProductoID})">
                <div><div style="font-weight:800;">${esc(r.Nombre)}</div>
                     <div class="muted">${r.TipoItem === 'PREPARACION' ? 'Preparación' : esc(r.Categoria || '')}${tiene ? ` · ${r.Ingredientes} insumo(s)` : ' · sin receta'}</div></div>
                <div style="text-align:right;">${tiene
                    ? (fc != null ? `<span class="badge ${this.semaforo(fc)}">${pct(fc)}</span>` : `<span class="badge b-gris">${money(r.CostoPorcion, 4)}</span>`)
                    : '<span class="badge b-gris">—</span>'}</div>
            </div>`;
        }).join('');
    },

    async abrirReceta(productoId) {
        this.tab('recetas');
        try {
            const r = await api.get(`/costos/receta/${productoId}`);
            const cab = r.data;
            const lineas = (cab.lineas || []).map(l => {
                // Se muestra en la unidad en que se escribió (kg, l…); se guarda en base.
                const u = l.UnidadIngreso || l.UnidadBase;
                return { InsumoID: l.InsumoID, Unidad: u, Cantidad: +(Number(l.Cantidad) / Unidades.factor(l.UnidadBase, u)).toFixed(4), MermaPct: Number(l.MermaPct) || 0 };
            });
            this.recetaSel = { cab, lineas };
            this.renderListaRecetas();
            this.renderEditor();
        } catch (e) { Swal.fire('Error', errMsg(e), 'error'); }
    },

    renderEditor() {
        const { cab, lineas } = this.recetaSel;
        const esPrep = cab.TipoItem === 'PREPARACION';
        const candidatos = this.productos.filter(p => p.ProductoID !== cab.ProductoID && p.TipoItem !== 'SERVICIO' && p.EsPlatoReceta != 1);
        const puedeEditar = require('./permisos').puede('costos', 2);
        const filas = lineas.map((l, i) => {
            const ins = this.prod(l.InsumoID);
            const base = ins ? ins.UnidadBase : 'UND';
            return `<tr>
                <td><select onchange="CostosModule.cambiarLinea(${i}, 'InsumoID', this.value)" style="width:100%;">
                    <option value="">— Elegir insumo —</option>
                    ${candidatos.map(p => `<option value="${p.ProductoID}" ${p.ProductoID === l.InsumoID ? 'selected' : ''}>${esc(p.Nombre)}</option>`).join('')}
                </select></td>
                <td><input type="number" min="0" step="any" value="${l.Cantidad || ''}" style="width:90px;" oninput="CostosModule.cambiarLinea(${i}, 'Cantidad', this.value, true)"></td>
                <td><select onchange="CostosModule.cambiarLinea(${i}, 'Unidad', this.value)">${Unidades.opciones(base, l.Unidad)}</select></td>
                <td><input type="number" min="0" max="90" step="0.5" value="${l.MermaPct || 0}" style="width:70px;" oninput="CostosModule.cambiarLinea(${i}, 'MermaPct', this.value, true)" title="% que se pierde al limpiar/pelar/cocer"></td>
                <td class="num" id="cc-l-bruto-${i}"></td>
                <td class="num" id="cc-l-costo-${i}"></td>
                <td><button class="cc-btn mini" onclick="CostosModule.quitarLinea(${i})" title="Quitar"><i class="fas fa-xmark"></i></button></td>
            </tr>`;
        }).join('');

        document.getElementById('cc-rec-editor').innerHTML = `
            <div class="barra">
                <h3 style="margin:0;"><i class="fas ${esPrep ? 'fa-blender' : 'fa-utensils'}"></i> ${esc(cab.Nombre)}</h3>
                <span class="badge ${cab.RecetaID && cab.Activa ? 'b-ok' : 'b-gris'}">${cab.RecetaID ? (cab.Activa ? 'RECETA ACTIVA' : 'RECETA DESACTIVADA') : 'SIN RECETA'}</span>
                ${cab.Actualizada ? `<span class="muted">actualizada ${esc(cab.Actualizada)}</span>` : ''}
            </div>
            <p class="ayuda">${esPrep
                ? `Rendimiento = cuánto produce UN lote de esta receta, en ${Unidades.NOMBRE_BASE[cab.UnidadBase] || 'unidades'}. Se produce desde la pestaña Producción.`
                : 'Rendimiento = cuántas porciones salen de esta receta. Escriba las cantidades NETAS (lo que va al plato) y el % de merma de limpieza: el sistema descuenta el peso bruto.'}</p>
            <div class="fila">
                <div class="campo" style="width:150px;"><label>Rendimiento ${esPrep ? `(${(cab.UnidadBase || 'und').toLowerCase()})` : '(porciones)'}</label>
                    <input type="number" id="cc-rec-rend" min="0.001" step="any" value="${Number(cab.Rendimiento) || (esPrep ? 1000 : 1)}" oninput="CostosModule.recalcular()"></div>
                <div class="campo" style="width:120px;"><label>Tiempo (min)</label><input type="number" id="cc-rec-tiempo" min="0" step="1" value="${cab.TiempoMin || ''}"></div>
                ${esPrep ? '' : `<div class="campo" style="width:130px;"><label>Precio de carta</label><input type="text" value="${money(cab.PrecioVenta)}" readonly></div>`}
            </div>
            <table>
                <thead><tr><th>Insumo</th><th>Cantidad neta</th><th>Unidad</th><th>Merma %</th><th class="num">Bruto</th><th class="num">Costo</th><th></th></tr></thead>
                <tbody>${filas || '<tr><td colspan="7" class="vacio">Agregue los insumos de la receta.</td></tr>'}</tbody>
            </table>
            <div class="barra" style="margin-top:10px;">
                <button class="cc-btn" onclick="CostosModule.agregarLinea()"><i class="fas fa-plus"></i> Agregar insumo</button>
            </div>
            <div class="kpis" id="cc-rec-kpis"></div>
            <div class="campo" style="margin-bottom:14px;"><label>Preparación / instrucciones</label>
                <textarea id="cc-rec-instr" rows="3" maxlength="4000" placeholder="Pasos, emplatado, alérgenos…">${esc(cab.Instrucciones || '')}</textarea></div>
            ${puedeEditar ? `<div class="barra">
                <button class="cc-btn ok" onclick="CostosModule.guardarReceta()"><i class="fas fa-save"></i> Guardar receta</button>
                ${cab.RecetaID && cab.Activa ? `<button class="cc-btn danger" onclick="CostosModule.desactivarReceta()"><i class="fas fa-ban"></i> Desactivar</button>` : ''}
            </div>` : '<p class="ayuda">Solo el administrador o el cocinero editan recetas.</p>'}`;
        this.recalcular();
    },

    agregarLinea() { this.recetaSel.lineas.push({ InsumoID: null, Cantidad: '', Unidad: null, MermaPct: 0 }); this.renderEditor(); },
    quitarLinea(i) { this.recetaSel.lineas.splice(i, 1); this.renderEditor(); },
    cambiarLinea(i, campo, valor, soloRecalcular) {
        const l = this.recetaSel.lineas[i];
        if (campo === 'InsumoID') { l.InsumoID = parseInt(valor) || null; const p = this.prod(l.InsumoID); l.Unidad = p ? p.UnidadBase : null; }
        else if (campo === 'Unidad') l.Unidad = valor;
        else l[campo] = valor;
        if (soloRecalcular) this.recalcular(); else this.renderEditor();
    },

    recalcular() {
        if (!this.recetaSel) return;
        const { cab, lineas } = this.recetaSel;
        const rend = parseFloat(document.getElementById('cc-rec-rend')?.value) || 1;
        let total = 0;
        lineas.forEach((l, i) => {
            const p = this.prod(l.InsumoID);
            const bEl = document.getElementById(`cc-l-bruto-${i}`), cEl = document.getElementById(`cc-l-costo-${i}`);
            if (!p || !(parseFloat(l.Cantidad) > 0)) { if (bEl) bEl.textContent = '—'; if (cEl) cEl.textContent = '—'; return; }
            const netoBase = parseFloat(l.Cantidad) * Unidades.factor(p.UnidadBase, l.Unidad || p.UnidadBase);
            const bruto = netoBase / (1 - Math.min(90, parseFloat(l.MermaPct) || 0) / 100);
            const costo = bruto * Number(p.CostoPromedio || 0);
            total += costo;
            if (bEl) bEl.textContent = Unidades.fmt(bruto, p.UnidadBase);
            if (cEl) cEl.textContent = money(costo, 4);
        });
        const porcion = total / rend;
        const esPrep = cab.TipoItem === 'PREPARACION';
        const meta = parseFloat(this.config.FOOD_COST_OBJETIVO_PCT) || 30;
        const neto = this.precioNeto(cab.PrecioVenta);
        const fc = !esPrep && neto > 0 ? porcion / neto * 100 : null;
        const ivaF = this.config.PRECIO_INCLUYE_IVA !== '0' ? 1 + (parseFloat(this.config.IVA_PCT) || 0) / 100 : 1;
        const sugerido = porcion / (meta / 100) * ivaF;
        document.getElementById('cc-rec-kpis').innerHTML = `
            <div class="kpi"><div class="t">Costo de la receta</div><div class="v">${money(total, 4)}</div></div>
            <div class="kpi"><div class="t">${esPrep ? `Costo por ${(cab.UnidadBase || 'und').toLowerCase()}` : 'Costo por porción'}</div><div class="v">${money(porcion, 4)}</div></div>
            ${esPrep ? '' : `
            <div class="kpi"><div class="t">Food cost (sobre venta neta)</div><div class="v"><span class="badge ${this.semaforo(fc)}" style="font-size:1rem;">${pct(fc)}</span></div></div>
            <div class="kpi"><div class="t">Margen por porción</div><div class="v">${money(neto - porcion)}</div></div>
            <div class="kpi"><div class="t">Precio sugerido (meta ${meta}%)</div><div class="v">${money(sugerido)}</div></div>`}`;
    },

    async guardarReceta() {
        const { cab, lineas } = this.recetaSel;
        const validas = lineas.filter(l => l.InsumoID && parseFloat(l.Cantidad) > 0);
        if (!validas.length) return Swal.fire('Receta vacía', 'Agregue al menos un insumo con cantidad.', 'warning');
        if (validas.length !== lineas.length) return Swal.fire('Revise la receta', 'Hay líneas sin insumo o sin cantidad.', 'warning');
        try {
            const r = await api.put(`/costos/receta/${cab.ProductoID}`, {
                Rendimiento: parseFloat(document.getElementById('cc-rec-rend').value) || 1,
                TiempoMin: parseInt(document.getElementById('cc-rec-tiempo').value) || null,
                Instrucciones: document.getElementById('cc-rec-instr').value,
                lineas: validas.map(l => ({ InsumoID: l.InsumoID, Cantidad: parseFloat(l.Cantidad), Unidad: l.Unidad || this.prod(l.InsumoID).UnidadBase, MermaPct: parseFloat(l.MermaPct) || 0 })),
            });
            window.Toast.fire({ icon: 'success', title: `Receta guardada · costo ${money(r.data.costoPorcion, 4)}${cab.TipoItem !== 'PREPARACION' ? ` · alcanza para ${r.data.porciones}` : ''}` });
            await this.recargar();
        } catch (e) { Swal.fire('No se guardó', errMsg(e), 'error'); }
    },

    async desactivarReceta() {
        const { cab } = this.recetaSel;
        const ok = await Swal.fire({ title: '¿Desactivar la receta?', text: `"${cab.Nombre}" dejará de descontar insumos y volverá a usar su propio stock.`, icon: 'warning', showCancelButton: true, confirmButtonText: 'Desactivar' });
        if (!ok.isConfirmed) return;
        try { await api.delete(`/costos/receta/${cab.ProductoID}`); await this.recargar(); }
        catch (e) { Swal.fire('Error', errMsg(e), 'error'); }
    },

    // ================= INGRESO DE COMPRA =================
    agregarLineaIngreso() { this.lineasIngreso.push({ ProductoID: null, Cantidad: '', Unidad: 'COMPRA', Costo: '' }); this.renderIngreso(); },
    quitarLineaIngreso(i) { this.lineasIngreso.splice(i, 1); this.renderIngreso(); },
    cambiarIngreso(i, campo, valor, soloTotal) {
        const l = this.lineasIngreso[i];
        l[campo] = campo === 'ProductoID' ? (parseInt(valor) || null) : valor;
        if (campo === 'ProductoID') { const p = this.prod(l.ProductoID); l.Unidad = p && p.UnidadCompra ? 'COMPRA' : (p ? p.UnidadBase : 'UND'); }
        if (soloTotal) this.totalIngreso(); else this.renderIngreso();
    },
    renderIngreso() {
        const cands = this.productos.filter(p => p.TipoItem !== 'SERVICIO' && p.EsPlatoReceta != 1);
        document.getElementById('cc-ing-lineas').innerHTML = this.lineasIngreso.map((l, i) => {
            const p = this.prod(l.ProductoID);
            const base = p ? p.UnidadBase : 'UND';
            const optCompra = p && p.UnidadCompra ? `<option value="COMPRA" ${l.Unidad === 'COMPRA' ? 'selected' : ''}>${esc(p.UnidadCompra)} (= ${Unidades.fmt(p.FactorCompra, base)})</option>` : '';
            return `<tr>
                <td><select style="width:100%;" onchange="CostosModule.cambiarIngreso(${i}, 'ProductoID', this.value)">
                    <option value="">— Producto —</option>
                    ${cands.map(x => `<option value="${x.ProductoID}" ${x.ProductoID === l.ProductoID ? 'selected' : ''}>${esc(x.Nombre)}</option>`).join('')}</select></td>
                <td><input type="number" min="0" step="any" value="${l.Cantidad}" style="width:95px;" oninput="CostosModule.cambiarIngreso(${i}, 'Cantidad', this.value, true)"></td>
                <td><select onchange="CostosModule.cambiarIngreso(${i}, 'Unidad', this.value, true)">${optCompra}${Unidades.opciones(base, l.Unidad)}</select></td>
                <td><input type="number" min="0" step="0.0001" value="${l.Costo}" style="width:110px;" oninput="CostosModule.cambiarIngreso(${i}, 'Costo', this.value, true)"></td>
                <td class="num" id="cc-ing-sub-${i}"></td>
                <td><button class="cc-btn mini" onclick="CostosModule.quitarLineaIngreso(${i})"><i class="fas fa-xmark"></i></button></td>
            </tr>`;
        }).join('') || '<tr><td colspan="6" class="vacio">Agregue líneas.</td></tr>';
        this.totalIngreso();
    },
    totalIngreso() {
        let t = 0;
        this.lineasIngreso.forEach((l, i) => {
            const s = (parseFloat(l.Cantidad) || 0) * (parseFloat(l.Costo) || 0); t += s;
            const el = document.getElementById(`cc-ing-sub-${i}`); if (el) el.textContent = money(s);
        });
        document.getElementById('cc-ing-total').textContent = money(t);
    },
    async registrarIngreso() {
        const lineas = this.lineasIngreso.filter(l => l.ProductoID && parseFloat(l.Cantidad) > 0);
        if (!lineas.length) return Swal.fire('Sin líneas', 'Agregue productos con cantidad.', 'warning');
        if (lineas.some(l => l.Costo === '' || !(parseFloat(l.Costo) >= 0))) return Swal.fire('Falta el costo', 'Cada línea necesita su costo unitario (puede ser 0 si fue regalo).', 'warning');
        const payload = lineas.map(l => {
            const p = this.prod(l.ProductoID);
            if (l.Unidad === 'COMPRA') return { ProductoID: l.ProductoID, Cantidad: parseFloat(l.Cantidad), CostoUnitario: parseFloat(l.Costo), EnUnidadCompra: true };
            const f = Unidades.factor(p.UnidadBase, l.Unidad);
            return { ProductoID: l.ProductoID, Cantidad: parseFloat(l.Cantidad) * f, CostoUnitario: parseFloat(l.Costo) / f };
        });
        try {
            const r = await api.post('/costos/ingreso', {
                SedeID: this.getSedeId(), ProveedorID: document.getElementById('cc-ing-prov').value || null,
                Referencia: document.getElementById('cc-ing-ref').value.trim() || null, lineas: payload,
            });
            Swal.fire('Ingreso registrado', `${r.data.lineas} línea(s) por ${money(r.data.total)}. El costo promedio de cada producto quedó actualizado.`, 'success');
            document.getElementById('cc-ing-ref').value = '';
            await this.recargar();
            this.agregarLineaIngreso();
        } catch (e) { Swal.fire('No se registró', errMsg(e), 'error'); }
    },

    // ================= PRODUCCIÓN =================
    async previewProduccion() {
        const box = document.getElementById('cc-prd-preview');
        const id = parseInt(document.getElementById('cc-prd-prod').value);
        const lotes = parseFloat(document.getElementById('cc-prd-lotes').value) || 0;
        if (!id) { box.innerHTML = ''; return; }
        try {
            const r = await api.get(`/costos/receta/${id}`);
            if (!r.data.RecetaID || !r.data.lineas.length) { box.innerHTML = '<p class="ayuda">Esta preparación aún no tiene receta: ármela en la pestaña Recetas.</p>'; return; }
            const filas = r.data.lineas.map(l => {
                const usa = Number(l.CantidadBruta) * lotes, falta = usa > Number(l.StockActual);
                return `<tr><td>${esc(l.Nombre)}</td><td class="num">${Unidades.fmt(usa, l.UnidadBase)}</td>
                    <td class="num" style="${falta ? 'color:#c0392b; font-weight:900;' : ''}">${Unidades.fmt(l.StockActual, l.UnidadBase)}${falta ? ' · FALTA' : ''}</td>
                    <td class="num">${money(usa * Number(l.CostoPromedio || 0), 4)}</td></tr>`;
            }).join('');
            const costo = r.data.lineas.reduce((a, l) => a + Number(l.CantidadBruta) * lotes * Number(l.CostoPromedio || 0), 0);
            box.innerHTML = `<p class="ayuda">Producirá ${Unidades.fmt(Number(r.data.Rendimiento) * lotes, r.data.UnidadBase)} · costo estimado ${money(costo)}</p>
                <table><thead><tr><th>Insumo</th><th class="num">Usará</th><th class="num">Hay</th><th class="num">Costo</th></tr></thead><tbody>${filas}</tbody></table>`;
        } catch (e) { box.innerHTML = ''; }
    },
    async producir() {
        const id = parseInt(document.getElementById('cc-prd-prod').value);
        if (!id) return;
        const real = document.getElementById('cc-prd-real').value;
        try {
            const r = await api.post('/costos/produccion', {
                SedeID: this.getSedeId(), ProductoID: id, Lotes: parseFloat(document.getElementById('cc-prd-lotes').value),
                CantidadReal: real === '' ? null : parseFloat(real), Notas: document.getElementById('cc-prd-notas').value,
            });
            Swal.fire('Producción registrada', `${Unidades.fmt(r.data.cantidad, r.data.unidadBase)} de ${esc(r.data.nombre)} · costo ${money(r.data.costoTotal)} (${Unidades.fmtCosto(r.data.costoUnitario, r.data.unidadBase)})`, 'success');
            document.getElementById('cc-prd-real').value = ''; document.getElementById('cc-prd-notas').value = '';
            await this.recargar(); this.cargarProducciones();
        } catch (e) { Swal.fire('No se registró', errMsg(e), 'error'); }
    },
    async cargarProducciones() {
        const box = document.getElementById('cc-prd-lista');
        try {
            const r = await api.get(`/costos/producciones/${this.getSedeId()}`, { params: { desde: document.getElementById('cc-prd-desde').value, hasta: document.getElementById('cc-prd-hasta').value } });
            box.innerHTML = r.data.length ? `<table><thead><tr><th>#</th><th>Fecha</th><th>Preparación</th><th class="num">Lotes</th><th class="num">Producido</th><th class="num">Costo</th><th>Usuario</th><th>Estado</th><th></th></tr></thead><tbody>
                ${r.data.map(p => `<tr style="${p.Estado === 'ANULADA' ? 'opacity:.55;' : ''}"><td>${p.ProduccionID}</td><td>${esc(p.Fecha)}</td><td>${esc(p.Nombre)}${p.Notas ? `<div class="muted">${esc(p.Notas)}</div>` : ''}</td>
                    <td class="num">${Number(p.Lotes)}</td><td class="num">${Unidades.fmt(p.Cantidad, p.UnidadBase)}</td><td class="num">${money(p.CostoTotal)}</td>
                    <td>${esc(p.NombreUsuario || '')}</td><td><span class="badge ${p.Estado === 'ACTIVA' ? 'b-ok' : 'b-gris'}" title="${esc(p.MotivoAnulacion || '')}">${p.Estado}</span></td>
                    <td>${p.Estado === 'ACTIVA' && this.esAdmin() ? `<button class="cc-btn mini" onclick="CostosModule.anularProduccion(${p.ProduccionID})" title="Anular"><i class="fas fa-rotate-left"></i></button>` : ''}</td></tr>`).join('')}
                </tbody></table>` : '<div class="vacio">Sin producciones en el período.</div>';
        } catch (e) { box.innerHTML = `<div class="vacio">${esc(errMsg(e))}</div>`; }
    },
    async anularProduccion(id) {
        const { value: motivo } = await Swal.fire({ title: `Anular producción #${id}`, input: 'text', inputPlaceholder: 'Motivo', text: 'Se retira lo producido y vuelven los insumos. Si ya se usó parte, registre una merma en su lugar.', showCancelButton: true, inputValidator: v => !v && 'Escriba el motivo' });
        if (!motivo) return;
        try { await api.post(`/costos/produccion/${id}/anular`, { Motivo: motivo }); window.Toast.fire({ icon: 'success', title: 'Producción anulada' }); await this.recargar(); this.cargarProducciones(); }
        catch (e) { Swal.fire('No se anuló', errMsg(e), 'error'); }
    },

    // ================= MERMAS =================
    unidadesMerma() {
        const p = this.prod(document.getElementById('cc-mer-prod').value);
        document.getElementById('cc-mer-unidad').innerHTML = Unidades.opciones(p ? p.UnidadBase : 'UND');
    },
    async registrarMerma() {
        const id = parseInt(document.getElementById('cc-mer-prod').value);
        const cant = parseFloat(document.getElementById('cc-mer-cant').value);
        const motivo = document.getElementById('cc-mer-motivo').value.trim();
        if (!id || !(cant > 0)) return Swal.fire('Datos incompletos', 'Elija el producto y la cantidad.', 'warning');
        if (!motivo) return Swal.fire('Falta el motivo', 'Describa qué pasó.', 'warning');
        try {
            const r = await api.post('/costos/merma', { SedeID: this.getSedeId(), ProductoID: id, Cantidad: cant, Unidad: document.getElementById('cc-mer-unidad').value, Categoria: document.getElementById('cc-mer-cat').value, Motivo: motivo });
            window.Toast.fire({ icon: 'success', title: `Merma registrada (${money(r.data.valor)})` });
            document.getElementById('cc-mer-cant').value = ''; document.getElementById('cc-mer-motivo').value = '';
            await this.recargar(); this.cargarMermas();
        } catch (e) { Swal.fire('No se registró', errMsg(e), 'error'); }
    },
    async cargarMermas() {
        const box = document.getElementById('cc-mer-lista');
        try {
            const r = await api.get(`/costos/mermas/${this.getSedeId()}`, { params: { desde: document.getElementById('cc-mer-desde').value, hasta: document.getElementById('cc-mer-hasta').value } });
            document.getElementById('cc-mer-total').textContent = money(r.data.total);
            box.innerHTML = r.data.items.length ? `<table><thead><tr><th>Fecha</th><th>Producto</th><th class="num">Cantidad</th><th class="num">Valor</th><th>Motivo</th><th>Usuario</th></tr></thead><tbody>
                ${r.data.items.map(m => `<tr><td>${esc(m.Fecha)}</td><td>${esc(m.Nombre)}</td><td class="num">${Unidades.fmt(m.Cantidad, m.UnidadBase)}</td><td class="num">${money(m.Valor)}</td><td>${esc(m.Motivo)}</td><td>${esc(m.Usuario)}</td></tr>`).join('')}
                </tbody></table>` : '<div class="vacio">Sin mermas en el período.</div>';
        } catch (e) { box.innerHTML = `<div class="vacio">${esc(errMsg(e))}</div>`; }
    },

    // ================= FOOD COST =================
    async cargarFoodCost() {
        const box = document.getElementById('cc-fc-tabla');
        try {
            const r = await api.get(`/costos/foodcost/${this.getSedeId()}`, { params: { desde: document.getElementById('cc-fc-desde').value, hasta: document.getElementById('cc-fc-hasta').value } });
            const d = r.data;
            const estimadas = d.items.reduce((a, x) => a + (x.LineasEstimadas || 0), 0);
            document.getElementById('cc-fc-nota').innerHTML = `Ventas ${d.config.PRECIO_INCLUYE_IVA === '0' ? 'sin IVA' : `sin IVA (${d.config.IVA_PCT}% descontado del precio)`}. Meta de food cost: <strong>${d.config.FOOD_COST_OBJETIVO_PCT}%</strong>.` +
                (estimadas ? ` <span class="badge b-medio">${estimadas} venta(s) anteriores a la Fase 2 con costo ESTIMADO (costo promedio actual)</span>` : '');
            const nombres = { ALIMENTO: 'Alimentos', BEBIDA: 'Bebidas', COMERCIAL: 'Comercial / tienda' };
            const tot = d.porTipo.reduce((a, t) => ({ v: a.v + t.VentasNetas, c: a.c + t.Costo }), { v: 0, c: 0 });
            document.getElementById('cc-fc-kpis').innerHTML = [
                `<div class="kpi"><div class="t">Venta neta total</div><div class="v">${money(tot.v)}</div></div>`,
                `<div class="kpi"><div class="t">Costo de lo vendido</div><div class="v">${money(tot.c)}</div></div>`,
                `<div class="kpi"><div class="t">Margen bruto</div><div class="v">${money(tot.v - tot.c)}</div></div>`,
                ...d.porTipo.map(t => `<div class="kpi"><div class="t">${nombres[t.Tipo] || esc(t.Tipo)} · costo</div><div class="v"><span class="badge ${this.semaforo(t.CostoPct)}" style="font-size:1rem;">${pct(t.CostoPct)}</span></div></div>`),
            ].join('');
            box.innerHTML = d.items.length ? `<table><thead><tr><th>Producto</th><th>Categoría</th><th class="num">Unid.</th><th class="num">Venta neta</th><th class="num">Costo</th><th class="num">Margen</th><th class="num">Costo %</th></tr></thead><tbody>
                ${d.items.map(x => `<tr><td>${esc(x.Nombre)}${x.LineasEstimadas ? ' <span class="badge b-medio" title="Vendido antes de la Fase 2">EST.</span>' : ''}${x.Cortesias ? ` <span class="muted">(${x.Cortesias} cortesía)</span>` : ''}</td>
                    <td>${esc(x.Categoria)}</td><td class="num">${x.Unidades}</td><td class="num">${money(x.VentasNetas)}</td><td class="num">${money(x.Costo)}</td>
                    <td class="num">${money(x.Margen)}</td><td class="num"><span class="badge ${this.semaforo(x.CostoPct)}">${pct(x.CostoPct)}</span></td></tr>`).join('')}
                </tbody></table>` : '<div class="vacio">Sin ventas en el período.</div>';
        } catch (e) { box.innerHTML = `<div class="vacio">${esc(errMsg(e))}</div>`; }
    },
    async guardarConfig() {
        try {
            await api.put('/config-sede/parametros', { SedeID: this.getSedeId(), config: {
                FOOD_COST_OBJETIVO_PCT: document.getElementById('cc-cfg-meta').value,
                PRECIO_INCLUYE_IVA: document.getElementById('cc-cfg-iva-incl').value,
                IVA_PCT: document.getElementById('cc-cfg-iva').value,
            } });
            window.Toast.fire({ icon: 'success', title: 'Meta guardada' });
            await this.recargar(); this.cargarFoodCost();
        } catch (e) { Swal.fire('No se guardó', errMsg(e), 'error'); }
    },

    // ================= VALORIZADO =================
    async cargarValorizado() {
        try {
            const r = await api.get(`/costos/valorizado/${this.getSedeId()}`);
            this.valorizado = r.data.items || [];
            document.getElementById('cc-val-total').textContent = money(r.data.total);
            this.renderValorizado();
        } catch (e) { document.getElementById('cc-val-tabla').innerHTML = `<div class="vacio">${esc(errMsg(e))}</div>`; }
    },
    renderValorizado() {
        const solo = document.getElementById('cc-val-bajo').checked;
        const items = this.valorizado.filter(x => !solo || x.BajoMinimo == 1);
        document.getElementById('cc-val-tabla').innerHTML = items.length ? `<table><thead><tr><th>Producto</th><th>Tipo</th><th>Categoría</th><th class="num">Stock</th><th class="num">Mínimo</th><th class="num">Costo prom.</th><th class="num">Valor</th><th></th></tr></thead><tbody>
            ${items.map(x => `<tr><td>${esc(x.Nombre)}</td><td>${esc(x.TipoItem)}</td><td>${esc(x.Categoria)}</td>
                <td class="num" style="${x.BajoMinimo == 1 ? 'color:#c0392b; font-weight:900;' : ''}">${Unidades.fmt(x.StockActual, x.UnidadBase)}</td>
                <td class="num">${Unidades.fmt(x.StockMinimo, x.UnidadBase)}</td><td class="num">${Unidades.fmtCosto(x.CostoPromedio, x.UnidadBase)}</td>
                <td class="num">${money(x.Valor)}</td><td><button class="cc-btn mini" onclick="CostosModule.verKardex(${x.ProductoID})" title="Kardex"><i class="fas fa-list-ol"></i></button></td></tr>`).join('')}
            </tbody></table>` : '<div class="vacio">Nada que mostrar.</div>';
    },

    // ================= KARDEX =================
    verKardex(id) {
        this.tab('kardex');
        document.getElementById('cc-kdx-prod').value = id;
        this.cargarKardex();
    },
    async cargarKardex() {
        const id = document.getElementById('cc-kdx-prod').value;
        if (!id) return;
        try {
            const r = await api.get(`/costos/kardex/${id}`, { params: { desde: document.getElementById('cc-kdx-desde').value, hasta: document.getElementById('cc-kdx-hasta').value } });
            const p = r.data.producto;
            document.getElementById('cc-kdx-cab').innerHTML = `<div class="kpis">
                <div class="kpi"><div class="t">Stock actual</div><div class="v">${Unidades.fmt(p.StockActual, p.UnidadBase)}</div></div>
                <div class="kpi"><div class="t">Costo promedio</div><div class="v">${Unidades.fmtCosto(p.CostoPromedio, p.UnidadBase)}</div></div>
                <div class="kpi"><div class="t">Valor en inventario</div><div class="v">${money(Number(p.StockActual) * Number(p.CostoPromedio))}</div></div></div>`;
            const m = r.data.movimientos;
            document.getElementById('cc-kdx-tabla').innerHTML = m.length ? `<table><thead><tr><th>Fecha</th><th>Movimiento</th><th class="num">Entra</th><th class="num">Sale</th><th class="num">Costo unit.</th><th class="num">Valor</th><th class="num">Saldo</th><th>Detalle</th><th>Usuario</th></tr></thead><tbody>
                ${m.map(k => `<tr><td>${esc(k.Fecha)}</td><td><span class="badge ${k.Signo > 0 ? 'b-ok' : 'b-alto'}">${esc(TIPOS_MOV[k.TipoMovimiento] || k.TipoMovimiento)}</span></td>
                    <td class="num">${k.Signo > 0 ? Unidades.fmt(k.Cantidad, p.UnidadBase) : ''}</td><td class="num">${k.Signo < 0 ? Unidades.fmt(k.Cantidad, p.UnidadBase) : ''}</td>
                    <td class="num">${k.CostoUnitario != null ? Unidades.fmtCosto(k.CostoUnitario, p.UnidadBase) : '—'}</td><td class="num">${k.CostoUnitario != null ? money(k.Valor) : '—'}</td>
                    <td class="num">${k.StockResultante != null ? Unidades.fmt(k.StockResultante, p.UnidadBase) : '—'}</td>
                    <td>${esc(k.Motivo || '')}${k.PlatoOrigen ? `<div class="muted">por receta: ${esc(k.PlatoOrigen)}</div>` : ''}${k.Referencia ? `<div class="muted">ref. ${esc(k.Referencia)}</div>` : ''}</td>
                    <td>${esc(k.Usuario)}</td></tr>`).join('')}
                </tbody></table>` : '<div class="vacio">Sin movimientos en el período.</div>';
        } catch (e) { document.getElementById('cc-kdx-tabla').innerHTML = `<div class="vacio">${esc(errMsg(e))}</div>`; }
    },
};

window.CostosModule = CostosModule;
module.exports = CostosModule;
