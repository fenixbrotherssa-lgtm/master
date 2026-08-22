const api = require('./api');

const RestauranteModule = {
    mesas: [],
    mesaSeleccionada: null,
    productosCarta: [],
    categoriasCarta: [],
    categoriaFiltroActual: 'ALL',
    cajaId: null,

    async init() {
        console.log("🚀 Módulo Restaurante Móvil iniciado...");
        await this.verificarCaja();
        await this.cargarMesas();
        await this.cargarInventarioVenta();
        this.setupEventListeners();
        this.setupSocket();
        window.RestauranteModule = this;
    },

    setupSocket() {
        if (!window.socket) return;
        window.socket.on('mesa:cambio', (data) => {
            this.cargarMesas();
            if (data.estado === 'LIBRE' && this.mesaSeleccionada && this.mesaSeleccionada.MesaID === data.mesaId) {
                this.mesaSeleccionada = null;
                this.resetUICompleto();
                if (window.Toast) window.Toast.fire({ icon: 'info', title: 'Mesa cerrada', text: 'Esta mesa fue cobrada', timer: 3000 });
            }
        });
        window.socket.on('cocina:item_listo', (data) => {
            // Notificación visual + vibración al mesero
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
            if (window.Toast) {
                window.Toast.fire({
                    icon: 'success',
                    title: `🍽 MESA ${data.nroMesa} — LISTO`,
                    text: data.nombreProducto,
                    timer: 5000,
                    timerProgressBar: true,
                    showConfirmButton: false
                });
            }
        });
    },

    async verificarCaja() {
        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const sedeId = localStorage.getItem('currentSedeId') || user.SedeID;
            const res = await api.get(`/caja/estado/${user.UsuarioID}/${sedeId}`);
            this.cajaId = res.data.abierta ? res.data.caja.CajaID : null;
        } catch(e) { console.warn("Caja no verificada", e); }
    },

    // ==========================================
    // MESAS
    // ==========================================
    async cargarMesas() {
        try {
            const sedeId = localStorage.getItem('currentSedeId') || JSON.parse(localStorage.getItem('user')).SedeID;
            const res = await api.get(`/restaurante/mesas/${sedeId}`);
            this.mesas = res.data;
            this.renderMesas();
        } catch (err) { console.error("Error cargando mesas", err); }
    },

    renderMesas() {
        const grid = document.getElementById('grid-mesas');
        if (!grid) return;

        if (this.mesas.length === 0) {
            grid.innerHTML = '<p style="grid-column:1/-1; text-align:center; opacity:0.5; margin-top:30px;">No hay mesas configuradas.</p>';
            return;
        }

        grid.innerHTML = this.mesas.map(m => {
            const libre = m.Estado === 'LIBRE';
            const borderColor = libre ? '#27ae60' : '#e74c3c';
            const bg = libre ? '#e0e0e4' : '#fdf2f2';
            const ocupante = m.Huesped
                ? `<div style="font-size:0.6rem; color:#c5a059; font-weight:900; margin-top:5px; text-align:center;">${m.Huesped.split(' ')[0]}</div>`
                : '';

            return `
                <div onclick="RestauranteModule.seleccionarMesa(${m.MesaID})"
                    style="background:${bg}; border-radius:20px; padding:25px 10px;
                           display:flex; flex-direction:column; align-items:center; justify-content:center;
                           box-shadow:6px 6px 12px #bebebe, -6px -6px 12px #ffffff;
                           border:4px solid ${borderColor}; cursor:pointer;">
                    <div style="font-size:2rem; font-weight:900; color:#1a365d; line-height:1;">${m.NroMesa}</div>
                    <div style="font-size:0.65rem; font-weight:800; text-transform:uppercase; margin-top:5px; color:${borderColor};">${m.Estado}</div>
                    ${ocupante}
                </div>
            `;
        }).join('');
    },

    async seleccionarMesa(id) {
        const mesa = this.mesas.find(m => m.MesaID === id);
        if (!mesa) return;
        this.mesaSeleccionada = mesa;

        const elNro = document.getElementById('ui-comanda-nro');
        if (elNro) elNro.textContent = `MESA ${mesa.NroMesa}`;

        const elActivaMovil = document.getElementById('comanda-activa-movil');
        if (elActivaMovil) elActivaMovil.style.display = 'flex';

        if (mesa.Estado === 'LIBRE' || !mesa.ComandaID) {
            this.resetUIDetalle();
        } else {
            await this.cargarDetallePedido(mesa.ComandaID);
        }
    },

    // ==========================================
    // INVENTARIO Y CATEGORÍAS
    // ==========================================
    async cargarInventarioVenta() {
        try {
            const sedeId = localStorage.getItem('currentSedeId') || JSON.parse(localStorage.getItem('user')).SedeID;
            const res = await api.get(`/inventario/sede/${sedeId}`);
            this.productosCarta = res.data.filter(p => p.PrecioVenta > 0);
            this.extraerCategoriasActivas();
        } catch (err) { console.error("Error cargando inventario", err); }
    },

    extraerCategoriasActivas() {
        const mapa = new Map();
        this.productosCarta.forEach(p => {
            if (p.CategoriaID && p.CategoriaNombre) mapa.set(p.CategoriaID, p.CategoriaNombre);
        });
        this.categoriasCarta = Array.from(mapa, ([id, nombre]) => ({ id, nombre }));
    },

    renderFiltrosCategorias() {
        const container = document.getElementById('filtros-categorias');
        if (!container) return;

        let html = `<button class="btn-neo-filter ${this.categoriaFiltroActual === 'ALL' ? 'active' : ''}" onclick="RestauranteModule.filtrarPorCategoria('ALL')">TODOS</button>`;
        html += this.categoriasCarta.map(c =>
            `<button class="btn-neo-filter ${this.categoriaFiltroActual === c.id ? 'active' : ''}" onclick="RestauranteModule.filtrarPorCategoria(${c.id})">${c.nombre}</button>`
        ).join('');
        container.innerHTML = html;
    },

    filtrarPorCategoria(catId) {
        this.categoriaFiltroActual = catId;
        this.renderFiltrosCategorias();
        const q = document.getElementById('in-buscar-plato')?.value || '';
        this.renderProductosBusqueda(q);
    },

    // ==========================================
    // BUSCADOR DE PLATOS — ABRE/CIERRA CON display flex/none
    // ==========================================
    abrirBuscadorPlatos() {
        if (!this.mesaSeleccionada) return;
        const modal = document.getElementById('modalPlatos');
        if (!modal) return;

        this.categoriaFiltroActual = 'ALL';
        modal.style.display = 'flex';        // <-- CORRECCIÓN: display flex directo
        this.renderFiltrosCategorias();
        this.renderProductosBusqueda();

        setTimeout(() => {
            const inB = document.getElementById('in-buscar-plato');
            if (inB) { inB.value = ''; inB.focus(); }
        }, 100);
    },

    cerrarBuscadorPlatos() {
        const modal = document.getElementById('modalPlatos');
        if (modal) modal.style.display = 'none'; // <-- CORRECCIÓN: ocultar con display none
    },

    renderProductosBusqueda(q = '') {
        const grid = document.getElementById('grid-platos-pos');
        if (!grid) return;

        const filtrados = this.productosCarta.filter(p => {
            const coincideTexto = p.Nombre.toLowerCase().includes(q.toLowerCase()) ||
                                  (p.CodigoBarras && p.CodigoBarras.includes(q));
            const coincideCategoria = this.categoriaFiltroActual === 'ALL' || p.CategoriaID === this.categoriaFiltroActual;
            return coincideTexto && coincideCategoria;
        });

        if (filtrados.length === 0) {
            grid.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:#718096; margin-top:20px;">No se encontraron productos.</p>`;
            return;
        }

        grid.innerHTML = filtrados.map(p => `
            <div onclick="RestauranteModule.accionAgregarItem(${p.ProductoID})"
                style="background:#e0e0e4; border-radius:15px; padding:15px 10px; text-align:center; cursor:pointer;
                       box-shadow:5px 5px 10px #bebebe, -5px -5px 10px #ffffff;">
                <div style="font-weight:900; color:#1a365d; font-size:0.85rem; margin-bottom:8px; line-height:1.2;">${p.Nombre}</div>
                <div style="color:#27ae60; font-weight:900; font-size:1.1rem;">$${parseFloat(p.PrecioVenta).toFixed(2)}</div>
                <div style="font-size:0.65rem; opacity:0.6; margin-top:4px;">Stock: ${p.StockActual}</div>
            </div>
        `).join('');
    },

    // ==========================================
    // AGREGAR / ELIMINAR ÍTEMS
    // ==========================================
   async accionAgregarItem(prodId) {
    const prod = this.productosCarta.find(p => p.ProductoID === prodId);
    if (!prod) return;
    const user = JSON.parse(localStorage.getItem('user'));
    const sedeId = localStorage.getItem('currentSedeId') || user.SedeID;

    try {
        if (this.mesaSeleccionada.Estado === 'LIBRE') {
            const resA = await api.post('/restaurante/abrir', {
                mesaId: this.mesaSeleccionada.MesaID,
                usuarioId: user.UsuarioID,
                sedeId: sedeId
            });
            this.mesaSeleccionada.ComandaID = resA.data.comandaId;
            this.mesaSeleccionada.Estado = 'OCUPADA';
            await this.cargarMesas();
        }

        await api.post('/restaurante/agregar', {
            comandaId: this.mesaSeleccionada.ComandaID,
            productoId: prod.ProductoID,
            cantidad: 1,
            precio: prod.PrecioVenta
        });

        window.Toast.fire({ icon: 'success', title: prod.Nombre, timer: 800 });
        this.cerrarBuscadorPlatos();
        await this.cargarDetallePedido(this.mesaSeleccionada.ComandaID);

    } catch (e) {
        const mensajeError = e.response?.data?.error || 'Error al agregar producto';
        console.error("❌ Error Restaurante: " + mensajeError);

        // Forzamos el contenedor de SweetAlert a ponerse en la capa 30000 para pasarle por encima al buscador
        window.Toast.fire({
            icon: 'warning',
            title: 'Control de Inventario',
            text: mensajeError,
            timer: 3500,
            willOpen: () => {
                const container = document.querySelector('.swal2-container');
                if (container) container.style.zIndex = '30000';
            }
        });
    }
},

    async eliminarItemPedido(detalleId) {
        try {
            const res = await api.delete(`/restaurante/detalle/${detalleId}`);
            if (res.data.success) {
                window.Toast.fire({ icon: 'success', title: 'Ítem removido', timer: 500 });
                await this.cargarDetallePedido(this.mesaSeleccionada.ComandaID);
            }
        } catch(e) {
            window.Toast.fire({ icon: 'error', title: 'Error al remover ítem' });
        }
    },

    async anularComandaActiva() {
        if (!this.mesaSeleccionada || !this.mesaSeleccionada.ComandaID) return;

        const confirm = await Swal.fire({
            title: '¿ANULAR COMANDA?',
            text: 'Se vaciará el pedido y la mesa quedará LIBRE.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#e74c3c',
            cancelButtonColor: '#1a365d',
            confirmButtonText: 'SÍ, RESETEAR',
            cancelButtonText: 'CANCELAR'
        });

        if (confirm.isConfirmed) {
            try {
                const res = await api.post('/restaurante/anular', { comandaId: this.mesaSeleccionada.ComandaID });
                if (res.data.success) {
                    window.Toast.fire({ icon: 'success', title: 'MESA RESETEADA' });
                    this.volverAMesas();
                    await this.cargarMesas();
                }
            } catch (err) {
                window.Toast.fire({ icon: 'error', title: 'ERROR', text: err.response?.data?.error || 'No se pudo liberar la mesa' });
            }
        }
    },

    // ==========================================
    // DETALLE DE COMANDA
    // ==========================================
    async cargarDetallePedido(comandaId) {
        try {
            const res = await api.get(`/restaurante/detalle/${comandaId}`);
            this.renderListaUI(res.data);
        } catch (e) { console.error(e); }
    },

    renderListaUI(items) {
        const box = document.getElementById('lista-platos-comanda');
        if (!box) return;
        let total = 0;

        if (items.length === 0) {
            box.innerHTML = '<p style="text-align:center; opacity:0.5; margin-top:20px;">Sin productos aún</p>';
            const elTotal = document.getElementById('ui-total-comanda');
            if (elTotal) elTotal.textContent = '$0.00';
            return;
        }

        box.innerHTML = items.map(i => {
            const sub = i.Cantidad * i.PrecioUnitario;
            total += sub;
            return `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 15px; margin-bottom:10px;
                            background:#e0e0e4; border-radius:15px; box-shadow:inset 3px 3px 6px #bebebe, inset -3px -3px 6px #ffffff;">
                    <div style="font-size:0.85rem; flex:1;"><strong>${i.Cantidad}x</strong> ${i.NombreProducto}</div>
                    <div style="font-weight:900; margin-right:15px; color:#1a365d;">$${sub.toFixed(2)}</div>
                    <button type="button" onclick="RestauranteModule.eliminarItemPedido(${i.DetalleID})"
                        style="background:none; border:none; color:#e74c3c; cursor:pointer; padding:5px; font-size:1rem;">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            `;
        }).join('');

        const elTotal = document.getElementById('ui-total-comanda');
        if (elTotal) elTotal.textContent = `$${total.toFixed(2)}`;
    },

    resetUIDetalle() {
        const box = document.getElementById('lista-platos-comanda');
        if (box) box.innerHTML = '<p style="text-align:center; opacity:0.5; margin-top:20px;">Mesa lista para nuevo pedido</p>';
        const elTotal = document.getElementById('ui-total-comanda');
        if (elTotal) elTotal.textContent = '$0.00';
    },

    resetUICompleto() {
        // Solo oculta el panel de comanda, NO borra mesaSeleccionada
        // para que finalizarCuenta() siga teniendo referencia a la mesa
        const elActivaMovil = document.getElementById('comanda-activa-movil');
        if (elActivaMovil) elActivaMovil.style.display = 'none';
        this.cerrarBuscadorPlatos();
    },

    // Llamado por el botón X — este SÍ limpia todo y vuelve al grid
    volverAMesas() {
        const elActivaMovil = document.getElementById('comanda-activa-movil');
        if (elActivaMovil) elActivaMovil.style.display = 'none';
        this.cerrarBuscadorPlatos();
        this.mesaSeleccionada = null;
    },

    // ==========================================
    // EVENT LISTENERS
    // ==========================================
    setupEventListeners() {
        const inB = document.getElementById('in-buscar-plato');
        if (inB) {
            inB.addEventListener('input', (e) => this.renderProductosBusqueda(e.target.value));
            inB.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const q = inB.value.trim().toLowerCase();
                    let p = this.productosCarta.find(x => x.CodigoBarras === q);
                    if (!p) {
                        p = this.productosCarta.find(x =>
                            (this.categoriaFiltroActual === 'ALL' || x.CategoriaID === this.categoriaFiltroActual) &&
                            x.Nombre.toLowerCase().includes(q)
                        );
                    }
                    if (p) { this.accionAgregarItem(p.ProductoID); inB.value = ''; }
                }
            });
        }
    },

    // ==========================================
    // COBROS
    // ==========================================
    async finalizarCuenta() {
        if (!this.mesaSeleccionada || !this.mesaSeleccionada.ComandaID) return;

        const totalStr = document.getElementById('ui-total-comanda').textContent.replace('$', '');
        const total = parseFloat(totalStr);
        if (total <= 0) return window.Toast.fire({ icon: 'warning', title: 'La comanda está vacía' });

        const result = await Swal.fire({
            title: '¿CÓMO PAGA LA MESA?',
            html: `<p style="font-size:1.2rem; font-weight:bold; color:#1a365d; margin-bottom:10px;">TOTAL: $${total.toFixed(2)}</p>`,
            icon: 'question',
            showCancelButton: true,
            showDenyButton: true,
            confirmButtonText: '<i class="fas fa-bed"></i> CARGO A HABITACIÓN',
            denyButtonText: '<i class="fas fa-cash-register"></i> CAJA (LOBBY)',
            cancelButtonText: 'CANCELAR',
            confirmButtonColor: '#1a365d',
            denyButtonColor: '#27ae60'
        });

        const user = JSON.parse(localStorage.getItem('user'));

        if (result.isConfirmed) {
            // CARGO A HABITACIÓN
            try {
                const sedeId = localStorage.getItem('currentSedeId') || user.SedeID;
                const resHabs = await api.get(`/recepcion/rack/${sedeId}`);
                const ocupadas = resHabs.data.filter(h => h.Estado === 'OCUPADA');

                if (ocupadas.length === 0) return Swal.fire('Sin huéspedes', 'No hay habitaciones ocupadas.', 'info');

                let opcionesHabs = {};
                ocupadas.forEach(h => { opcionesHabs[h.RecepcionID] = `HAB. ${h.NroHabitacion} - ${h.Huesped}`; });

                const { value: recepcionId } = await Swal.fire({
                    title: 'Seleccione la habitación',
                    input: 'select',
                    inputOptions: opcionesHabs,
                    inputPlaceholder: 'Lista de huéspedes',
                    showCancelButton: true,
                    confirmButtonColor: '#1a365d'
                });

                if (recepcionId) {
                    await this.procesarCobroBackend({
                        comandaId: this.mesaSeleccionada.ComandaID,
                        tipoCobro: 'HABITACION',
                        recepcionId: recepcionId
                    });
                }
            } catch(e) { console.error("Error cargando rack", e); }

        } else if (result.isDenied) {
            // CAJA / LOBBY
            if (!this.cajaId) return Swal.fire({ icon: 'error', title: 'CAJA CERRADA', text: 'Debe abrir turno de caja.' });

            const { value: formPago } = await Swal.fire({
                title: 'COBRO EN RESTAURANTE',
                html: `
                    <label style="display:block; text-align:left; font-weight:bold; font-size:0.8rem; margin-bottom:5px;">Método de Pago</label>
                    <select id="res-metodo" class="swal2-input" style="margin-bottom:15px;">
                        <option value="1">EFECTIVO</option>
                        <option value="2">TRANSFERENCIA</option>
                        <option value="3">TARJETA</option>
                    </select>
                    <label style="display:block; text-align:left; font-weight:bold; font-size:0.8rem; margin-bottom:5px;">Referencia (Opcional)</label>
                    <input id="res-ref" type="text" class="swal2-input" placeholder="Lote / Nro. Comprobante">
                `,
                focusConfirm: false,
                showCancelButton: true,
                confirmButtonText: 'PROCESAR COBRO',
                confirmButtonColor: '#27ae60',
                preConfirm: () => ({
                    metodoPago: document.getElementById('res-metodo').value,
                    referencia: document.getElementById('res-ref').value
                })
            });

            if (formPago) {
                const formData = new FormData();
                formData.append('comandaId', this.mesaSeleccionada.ComandaID);
                formData.append('tipoCobro', 'LOBBY');
                formData.append('cajaId', this.cajaId);
                formData.append('metodoPago', formPago.metodoPago);
                formData.append('referencia', formPago.referencia);
                formData.append('monto', total);
                await this.procesarCobroBackend(formData);
            }
        }
    },

    async procesarCobroBackend(payload) {
        try {
            const config = payload instanceof FormData ? { headers: { 'Content-Type': 'multipart/form-data' } } : {};
            const res = await api.post('/restaurante/cobrar', payload, config);
            if (res.data.success) {
                await Swal.fire({ icon: 'success', title: '¡CUENTA CERRADA!', text: 'Mesa liberada.' });
                this.volverAMesas();
                await this.cargarMesas();
            }
        } catch (err) {
            Swal.fire({ icon: 'error', title: 'Error al cobrar', text: err.response?.data?.error || 'Error de conexión' });
        }
    }
};

module.exports = RestauranteModule;