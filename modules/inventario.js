const api = require('./api');
const Unidades = require('./unidades');

const InventarioModule = {
    productos: [],
    categorias: [],
    // Estado interno para filtros
    state: {
        busqueda: '',
        categoria: 'TODAS',
        tipo: 'TODOS'
    },

    async init() {
        window.backView = 'inventarios';
        this.renderSedeSelector();
        await this.cargarCategorias();
        await this.cargarProductos();
        this.initForm();
        this.initFormCategoria();
        this.initFiltrosListeners();
        ['unidadBaseProd', 'unidadCompraProd'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener(id === 'unidadCompraProd' ? 'input' : 'change', () => this.ayudaUnidades());
        });
        this.setupSocket();
    },

    setupSocket() {
        if (!window.socket) return;
        window.socket.on('producto:stock', () => {
            this.cargarProductos();
        });
    },

    initFiltrosListeners() {
        const inputBusqueda = document.getElementById('filtroTexto');
        const selectCat = document.getElementById('filtroCategoria');
        const selectTipo = document.getElementById('filtroTipo');

        if (inputBusqueda) inputBusqueda.oninput = (e) => { this.state.busqueda = e.target.value; this.renderProductos(); };
        if (selectCat) selectCat.onchange = (e) => { this.state.categoria = e.target.value; this.renderProductos(); };
        if (selectTipo) selectTipo.onchange = (e) => { this.state.tipo = e.target.value; this.renderProductos(); };
    },

    // --- LÓGICA DE UI ---
    // Si la unidad de compra es estándar (KG, LB, L…) el contenido se calcula solo.
    ayudaUnidades() {
        const base = document.getElementById('unidadBaseProd')?.value || 'UND';
        const uc = (document.getElementById('unidadCompraProd')?.value || '').trim().toUpperCase();
        const fac = document.getElementById('factorProd');
        const lbl = document.getElementById('lblFactorProd');
        if (lbl) lbl.textContent = `Contenido (${Unidades.NOMBRE_BASE[base]})`;
        const std = (Unidades.COMPATIBLES[base] || []).find(x => x[0] === uc);
        if (std && fac) { fac.value = std[2]; fac.readOnly = true; } else if (fac) fac.readOnly = false;
    },

    toggleStockFields() {
        const container = document.getElementById('contenedorStock');
        if (!container) return;
        // Ahora SIEMPRE mostramos el stock, incluso para servicios (ej: cupos de parqueadero)
        container.style.display = 'flex';
    },

    renderSedeSelector() {
        App.renderSedeSelector('sedeSelectorInv', () => this.cargarProductos());
    },

    // --- CATEGORÍAS ---
    async cargarCategorias() {
        try {
            const res = await api.get('/inventario/categorias');
            this.categorias = res.data;
            this.renderCategoriasSelect();
            this.renderCategoriasLista();
            this.actualizarSelectFiltro();
        } catch (e) {
            console.error("Error al cargar categorías:", e);
        }
    },

    actualizarSelectFiltro() {
        const select = document.getElementById('filtroCategoria');
        if (!select) return;
        select.innerHTML = '<option value="TODAS">Todas las Categorías</option>' + 
            this.categorias.map(c => `<option value="${c.CategoriaID}">${c.Nombre}</option>`).join('');
    },

    renderCategoriasSelect() {
        const select = document.getElementById('catProdId');
        if (select) {
            select.innerHTML = this.categorias.map(c => 
                `<option value="${c.CategoriaID}">${c.Nombre}</option>`
            ).join('');
        }
    },

    renderCategoriasLista() {
        const lista = document.getElementById('listaCategorias');
        if (!lista) return;
        const tipoLabel = { ALIMENTO: '🍽 Alimento', BEBIDA: '🥤 Bebida', COMERCIAL: '🛒 Comercial' };
        const tipoColor = { ALIMENTO: '#27ae60', BEBIDA: '#2980b9', COMERCIAL: '#8e44ad' };
        lista.innerHTML = this.categorias.map(c => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; margin-bottom:10px; background:white; border-radius:15px; box-shadow: 4px 4px 8px #bebebe;">
                <div>
                    <span style="font-weight:700; color:#1a365d;">${c.Nombre}</span>
                    <span style="font-size:0.7rem; font-weight:700; color:white; background:${tipoColor[c.Tipo] || '#999'}; border-radius:8px; padding:2px 8px; margin-left:8px;">
                        ${tipoLabel[c.Tipo] || c.Tipo || 'COMERCIAL'}
                    </span>
                </div>
                <div style="display:flex; gap:6px;">
                    <button class="btn-neo" style="padding:5px 10px; color:#2980b9; box-shadow:none;" onclick="InventarioModule.editarTipoCategoria(${c.CategoriaID}, '${c.Nombre}', '${c.Tipo || 'COMERCIAL'}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-neo" style="padding:5px 10px; color:#e74c3c; box-shadow:none;" onclick="InventarioModule.eliminarCategoria(${c.CategoriaID})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    },

    async editarTipoCategoria(id, nombre, tipoActual) {
        const { value: nuevoTipo } = await Swal.fire({
            title: `Tipo de "${nombre}"`,
            input: 'select',
            inputOptions: { ALIMENTO: '🍽 Alimento', BEBIDA: '🥤 Bebida', COMERCIAL: '🛒 Comercial' },
            inputValue: tipoActual,
            showCancelButton: true,
            confirmButtonText: 'Guardar',
            cancelButtonText: 'Cancelar',
            background: '#e0e0e4'
        });
        if (!nuevoTipo) return;
        try {
            await api.post('/inventario/categorias', { CategoriaID: id, Nombre: nombre, Tipo: nuevoTipo });
            await this.cargarCategorias();
            window.Toast.fire({ icon: 'success', title: 'Tipo actualizado' });
        } catch (e) { console.error(e); }
    },

    async eliminarCategoria(id) {
        const result = await Swal.fire({
            title: '¿Eliminar categoría?',
            text: "Esto fallará si hay productos vinculados.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sí, eliminar',
            background: '#e0e0e4'
        });

        if (result.isConfirmed) {
            try {
                await api.delete(`/inventario/categorias/${id}`);
                await this.cargarCategorias();
                Swal.fire('Eliminado', 'La categoría ha sido borrada', 'success');
            } catch (e) {
                Swal.fire('Error', e.response?.data?.error || 'No se pudo eliminar', 'error');
            }
        }
    },

    initFormCategoria() {
        const formCat = document.getElementById('formCategoria');
        if (!formCat) return;
        formCat.onsubmit = async (e) => {
            e.preventDefault();
            const nombre = document.getElementById('nombreCat').value;
            const tipo = document.getElementById('tipoCat').value;
            try {
                await api.post('/inventario/categorias', { Nombre: nombre, Tipo: tipo });
                document.getElementById('nombreCat').value = '';
                await this.cargarCategorias();
                window.Toast.fire({ icon: 'success', title: 'Categoría guardada' });
            } catch (e) { console.error(e); }
        };
    },

    // --- PRODUCTOS Y RENDERIZADO ---
    async cargarProductos() {
        const selector = document.getElementById('globalSedeSelector');
        const sedeId = selector ? selector.value : App.user.SedeID;
        const grid = document.getElementById('gridProductos');
        if (!grid) return;
        grid.innerHTML = '<p style="text-align:center; grid-column: 1/-1;">Cargando inventario...</p>';

        try {
            const res = await api.get(`/inventario/sede/${sedeId}`);
            this.productos = res.data;
            this.renderProductos();
        } catch (e) {
            console.error("Error al cargar productos:", e);
        }
    },

    renderProductos() {
        const grid = document.getElementById('gridProductos');
        if (!grid) return;

        // 1. Filtrado basado en el Estado
        const productosFiltrados = this.productos.filter(p => {
            const matchBusqueda = p.Nombre.toLowerCase().includes(this.state.busqueda.toLowerCase());
            const matchCat = (this.state.categoria === 'TODAS' || p.CategoriaID == this.state.categoria);
            const matchTipo = (this.state.tipo === 'TODOS' || p.TipoItem === this.state.tipo
                               || (this.state.tipo === 'RECETA' && p.EsPlatoReceta == 1));
            return matchBusqueda && matchCat && matchTipo;
        });

        if (productosFiltrados.length === 0) {
            grid.innerHTML = '<p style="text-align:center; grid-column: 1/-1;">No se encontraron resultados.</p>';
            return;
        }

        // 2. Renderizado de Tarjetas
        grid.innerHTML = productosFiltrados.map(p => {
            const stockActual = Number(p.StockActual) || 0;
            const esReceta = p.EsPlatoReceta == 1;

            // Crítico: plato con receta sin porciones posibles, o stock bajo el mínimo
            const esCritico = p.Alerta == 1;

            // Etiqueta visual por tipo de ítem
            const iconTipo = p.TipoItem === 'SERVICIO' ? '<i class="fas fa-briefcase"></i> SERV | '
                : p.TipoItem === 'INSUMO' ? '<i class="fas fa-seedling"></i> INSUMO | '
                : p.TipoItem === 'PREPARACION' ? '<i class="fas fa-blender"></i> PREP. | '
                : esReceta ? '<i class="fas fa-utensils"></i> ' : '<i class="fas fa-box"></i> ';
            const stockTxt = esReceta ? `ALCANZA: ${stockActual} porc.` : `STOCK: ${Unidades.fmt(stockActual, p.UnidadBase)}`;
            const costoTxt = esReceta
                ? `Costo por porción $${Number(p.CostoPorcion || 0).toFixed(2)}`
                : (p.TipoItem !== 'SERVICIO' && Number(p.CostoPromedio) > 0 ? `Costo prom. ${Unidades.fmtCosto(p.CostoPromedio, p.UnidadBase)}` : '');
            const llevaReceta = p.TipoItem === 'VENTA' || p.TipoItem === 'PREPARACION';

            return `
            <div class="prod-card" style="${esCritico ? 'border: 2px solid var(--hotel-danger);' : ''}">
                <div class="stock-badge" style="color: ${esCritico ? 'var(--hotel-danger)' : '#1a365d'}">
                    ${iconTipo} ${stockTxt}
                    ${esCritico ? `<br><small style="font-weight:900;">${esReceta ? 'SIN INSUMOS' : 'BAJO MÍNIMO'}</small>` : ''}
                </div>
                
                <h4 style="margin: 10px 0; font-weight: 800; color: #1a365d;">${p.Nombre}</h4>
                <p style="font-size:0.7rem; color:#7f8c8d; margin-bottom:10px; text-transform: uppercase;">${p.CategoriaNombre || 'Sin Categoría'}</p>
                <span class="price-tag">$${parseFloat(p.PrecioVenta).toFixed(2)}</span>
                ${costoTxt ? `<p style="font-size:0.68rem; color:#4a5568; margin:6px 0 0;">${costoTxt}</p>` : ''}
                
                <div style="margin-top:15px; display:flex; flex-direction:column; gap:5px;">
                    <div style="display:flex; gap:5px;">
                        <button class="btn-neo" style="flex:1; min-width:0; justify-content:center; padding:10px 6px;" onclick="InventarioModule.editarProducto(${p.ProductoID})">
                            <i class="fas fa-edit"></i> FICHA
                        </button>
                        ${llevaReceta ? `<button class="btn-neo" style="flex:1; min-width:0; justify-content:center; padding:10px 6px;" title="Receta por gramos y costo" onclick="InventarioModule.abrirReceta(${p.ProductoID})">
                            <i class="fas fa-utensils"></i> RECETA</button>` : ''}
                        <button class="btn-neo" style="flex:0 0 auto; padding:10px 12px;" title="Kardex valorizado" onclick="InventarioModule.abrirKardex(${p.ProductoID})">
                            <i class="fas fa-list-ol"></i>
                        </button>
                    </div>

                    <div style="display:flex; gap:5px;">
                        ${esReceta ? '' : `<button class="btn-neo" style="flex:1; min-width:0; justify-content:center; padding:10px 6px;" onclick="InventarioModule.abrirModalMovimiento(${p.ProductoID}, 'INGRESO')">
                            <i class="fas fa-plus"></i> Ingreso
                        </button>
                        <button class="btn-neo" style="flex:1; min-width:0; justify-content:center; padding:10px 6px;" onclick="InventarioModule.abrirModalMovimiento(${p.ProductoID}, 'AJUSTE')">
                            <i class="fas fa-tools"></i> Ajuste
                        </button>`}
                        <button class="btn-neo" style="flex:0 0 auto; padding:10px 12px; color:#e74c3c; ${esReceta ? 'margin-left:auto;' : ''}" title="Eliminar" onclick="InventarioModule.eliminarProducto(${p.ProductoID})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
            `;
        }).join('');
    },

    // Abre Cocina y Costos directo en la receta / el kardex de este producto.
    abrirReceta(id) { window.__costosAbrir = { tipo: 'receta', id }; App.renderView('costos', 'viewport'); },
    abrirKardex(id) { window.__costosAbrir = { tipo: 'kardex', id }; App.renderView('costos', 'viewport'); },

    // --- GESTIÓN DE MOVIMIENTOS ---
    // Ingreso: cantidad en la unidad que elija (la de compra o la base) + costo por esa unidad,
    // así el kardex recalcula el costo promedio. Ajuste: salida con motivo (queda auditada).
    async abrirModalMovimiento(id, tipo) {
        const p = this.productos.find(x => x.ProductoID === id) || {};
        if (p.EsPlatoReceta == 1) {
            return Swal.fire('Plato con receta', 'Este plato no lleva stock propio: se descuentan sus insumos al venderlo. Ingrese o ajuste los insumos.', 'info');
        }
        const base = p.UnidadBase || 'UND';
        const factor = Number(p.FactorCompra) || 1;
        const tieneCompra = !!p.UnidadCompra && factor !== 1;
        const esIngreso = tipo === 'INGRESO';
        const { value: formValues } = await Swal.fire({
            title: esIngreso ? 'Registrar Ingreso' : 'Registrar Ajuste Negativo',
            html: `<p style="font-size:0.8rem; color:#718096;">${p.Nombre || ''} · stock ${Unidades.fmt(p.StockReal ?? p.StockActual, base)}</p>
                <div style="display:flex; gap:8px; align-items:center; justify-content:center;">
                    <input id="swal-cant" type="number" step="any" min="0" class="swal2-input" placeholder="Cantidad" style="width:45%; margin:6px 0;">
                    <select id="swal-unidad" class="swal2-input" style="width:45%; margin:6px 0;">
                        ${tieneCompra ? `<option value="COMPRA">${p.UnidadCompra} (= ${Unidades.fmt(factor, base)})</option>` : ''}
                        ${Unidades.opciones(base)}
                    </select>
                </div>
                ${esIngreso ? `<input id="swal-costo" type="number" step="0.0001" min="0" class="swal2-input" placeholder="Costo por esa unidad ($)" style="margin:6px 0;">` : ''}
                <input id="swal-motivo" type="text" class="swal2-input" placeholder="${esIngreso ? 'Factura / referencia' : 'Motivo (obligatorio)'}" style="margin:6px 0;">`,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'PROCESAR',
            cancelButtonText: 'CANCELAR',
            preConfirm: () => {
                const cant = parseFloat(document.getElementById('swal-cant').value);
                if (!(cant > 0)) { Swal.showValidationMessage('Ingrese una cantidad válida mayor a 0'); return false; }
                const motivo = document.getElementById('swal-motivo').value.trim();
                if (!esIngreso && !motivo) { Swal.showValidationMessage('El ajuste necesita un motivo'); return false; }
                const unidad = document.getElementById('swal-unidad').value;
                const f = unidad === 'COMPRA' ? factor : Unidades.factor(base, unidad);
                const costoEl = document.getElementById('swal-costo');
                const costo = costoEl && costoEl.value !== '' ? parseFloat(costoEl.value) : null;
                // Todo viaja en unidad base: cantidad × factor; costo ÷ factor.
                return { cantidad: Math.round(cant * f * 1000) / 1000, costo: costo != null ? costo / f : null, motivo };
            }
        });

        if (formValues && formValues.cantidad) {
            this.ejecutarMovimiento(id, tipo, formValues.cantidad, formValues.motivo, formValues.costo);
        }
    },

    async ejecutarMovimiento(id, tipo, cantidad, motivo, costoBase = null) {
        try {
            const selector = document.getElementById('globalSedeSelector');
            const user = JSON.parse(localStorage.getItem('user'));

            await api.post('/inventario/movimiento', {
                ProductoID: id,
                SedeID: selector ? selector.value : user.SedeID,
                UsuarioID: user.UsuarioID,
                Cantidad: cantidad,
                TipoMovimiento: tipo === 'INGRESO' ? 'INGRESO' : 'AJUSTE_NEGATIVO',
                Motivo: motivo || 'Sin motivo especificado',
                Referencia: tipo === 'INGRESO' && motivo ? motivo : undefined,
                ...(costoBase != null ? { CostoUnitario: costoBase } : {})
            });
            await this.cargarProductos();
            window.Toast.fire({ icon: 'success', title: 'Movimiento registrado correctamente' });
        } catch (e) {
            Swal.fire('Error', e.response?.data?.error || 'No se pudo registrar el movimiento', 'error');
        }
    },

    async eliminarProducto(id) {
        const result = await Swal.fire({
            title: '¿Eliminar producto?',
            text: "Si nunca ha tenido ventas ni movimientos se borra por completo. Si ya tiene historial, se desactivará en su lugar para no perderlo.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sí, continuar',
            cancelButtonText: 'Cancelar',
            background: '#e0e0e4'
        });
        if (!result.isConfirmed) return;

        try {
            const res = await api.delete(`/inventario/${id}`);
            await this.cargarProductos();
            Swal.fire(
                res.data.desactivada ? 'Desactivado' : 'Eliminado',
                res.data.message,
                'success'
            );
        } catch (e) {
            Swal.fire('Error', e.response?.data?.error || 'No se pudo eliminar el producto', 'error');
        }
    },

    async verDesactivados() {
        const selector = document.getElementById('globalSedeSelector');
        const user = JSON.parse(localStorage.getItem('user'));
        const sedeId = selector ? selector.value : user.SedeID;

        try {
            const res = await api.get(`/inventario/desactivados/${sedeId}`);
            const desactivados = res.data || [];

            if (desactivados.length === 0) {
                Swal.fire('Sin registros', 'No hay productos desactivados en esta sede.', 'info');
                return;
            }

            const html = `
                <div style="text-align:left; max-height:400px; overflow-y:auto;">
                    ${desactivados.map(p => `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; margin-bottom:8px; background:#f1f3f5; border-radius:10px;">
                            <div>
                                <strong>${p.Nombre}</strong>
                                <span style="font-size:0.75rem; color:#7f8c8d;"> — ${p.CategoriaNombre || 'Sin categoría'}</span>
                            </div>
                            <button class="btn-neo" style="padding:6px 12px;" onclick="InventarioModule.reactivarProducto(${p.ProductoID})">
                                <i class="fas fa-undo"></i> Reactivar
                            </button>
                        </div>
                    `).join('')}
                </div>`;

            Swal.fire({
                title: 'Productos desactivados',
                html,
                showConfirmButton: false,
                showCloseButton: true,
                background: '#e0e0e4',
                width: 500
            });
        } catch (e) {
            Swal.fire('Error', e.response?.data?.error || 'No se pudo cargar los productos desactivados', 'error');
        }
    },

    async reactivarProducto(id) {
        try {
            await api.post(`/inventario/${id}/reactivar`);
            Swal.close();
            await this.cargarProductos();
            window.Toast.fire({ icon: 'success', title: 'Producto reactivado' });
        } catch (e) {
            Swal.fire('Error', e.response?.data?.error || 'No se pudo reactivar el producto', 'error');
        }
    },

    // --- FORMULARIOS Y EDICIÓN ---
    initForm() {
        const form = document.getElementById('formProducto');
        if (!form) return;
        form.onsubmit = async (e) => {
            e.preventDefault();
            const selector = document.getElementById('globalSedeSelector');
            const user = JSON.parse(localStorage.getItem('user'));
            
            const data = {
                ProductoID: document.getElementById('productoId').value || null,
                SedeID: selector ? selector.value : user.SedeID,
                UsuarioID: user.UsuarioID,
                CategoriaID: document.getElementById('catProdId').value,
                Nombre: document.getElementById('nombreProd').value,
                PrecioVenta: parseFloat(document.getElementById('precioProd').value),
                CostoCompra: parseFloat(document.getElementById('costoProd').value),
                TipoItem: document.getElementById('tipoProd')?.value || 'VENTA',
                StockMinimo: parseInt(document.getElementById('minProd')?.value || 0),
                StockIdeal: parseInt(document.getElementById('idealProd')?.value || 0),
                CodigoBarras: document.getElementById('barraProd')?.value || null,
                UnidadBase: document.getElementById('unidadBaseProd')?.value || 'UND',
                UnidadCompra: (document.getElementById('unidadCompraProd')?.value || '').trim().toUpperCase() || null,
                FactorCompra: parseFloat(document.getElementById('factorProd')?.value) || 1,
                Estacion: document.getElementById('estacionProd')?.value || null,
                TarifaIVA: document.getElementById('tarifaIvaProd')?.value || '4'
            };

            try {
                await api.post('/inventario', data);
                this.cerrarModal();
                await this.cargarProductos();
                window.Toast.fire({ icon: 'success', title: 'Ficha guardada exitosamente' });
            } catch (e) {
                Swal.fire('Error', e.response?.data?.error || 'No se pudo guardar la ficha', 'error');
            }
        };
    },

    editarProducto(id) {
        const p = this.productos.find(prod => prod.ProductoID === id);
        if (!p) return;

        document.getElementById('productoId').value = p.ProductoID;
        document.getElementById('nombreProd').value = p.Nombre;
        document.getElementById('catProdId').value = p.CategoriaID;
        document.getElementById('precioProd').value = p.PrecioVenta;
        document.getElementById('costoProd').value = p.CostoCompra;
        
        if(document.getElementById('tipoProd')) {
            document.getElementById('tipoProd').value = p.TipoItem;
            this.toggleStockFields();
        }
        
        document.getElementById('minProd').value = p.StockMinimo;
        document.getElementById('idealProd').value = p.StockIdeal;
        document.getElementById('barraProd').value = p.CodigoBarras || '';
        document.getElementById('unidadBaseProd').value = p.UnidadBase || 'UND';
        document.getElementById('unidadCompraProd').value = p.UnidadCompra || '';
        document.getElementById('factorProd').value = Number(p.FactorCompra) || 1;
        document.getElementById('estacionProd').value = p.Estacion || '';
        if (document.getElementById('tarifaIvaProd')) document.getElementById('tarifaIvaProd').value = p.TarifaIVA || '4';
        this.ayudaUnidades();

        document.getElementById('modalProducto').classList.remove('hidden');
    },

    abrirModalProducto() {
        const form = document.getElementById('formProducto');
        if (form) form.reset();
        document.getElementById('productoId').value = '';
        document.getElementById('tipoProd').value = 'VENTA';
        document.getElementById('unidadBaseProd').value = 'UND';
        document.getElementById('factorProd').value = 1;
        if (document.getElementById('tarifaIvaProd')) document.getElementById('tarifaIvaProd').value = '4';
        this.toggleStockFields();
        this.ayudaUnidades();
        document.getElementById('modalProducto').classList.remove('hidden');
    },

    abrirModalCat() {
        document.getElementById('modalCategoria').classList.remove('hidden');
    },

    cerrarModal() {
        document.getElementById('modalProducto').classList.add('hidden');
        document.getElementById('modalCategoria').classList.add('hidden');
    }
};

window.InventarioModule = InventarioModule;
module.exports = InventarioModule;