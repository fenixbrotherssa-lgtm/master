const api = require('./api');

const RestauranteModule = {
    mesas: [],
    mesaSeleccionada: null,
    productosCarta: [],
    categoriasCarta: [],
    categoriaFiltroActual: 'ALL',
    cajaId: null,

    async init() {
        console.log("🚀 Módulo Restaurante Online...");

        const user = JSON.parse(localStorage.getItem('user'));
        this._isAdmin = user && parseInt(user.RolID) === 1;

        if (!this._isAdmin) {
            const btnCrear = document.querySelector('button[onclick="RestauranteModule.abrirModalMesa()"]');
            if (btnCrear) btnCrear.style.display = 'none';
        }

        this.renderSedeSelector();
        await this.verificarCaja();
        await this.cargarMesas();
        await this.cargarInventarioVenta();
        this.setupEventListeners();
        this.setupSocket();
        this.actualizarBadgeCocina();
        // Sincronizar con el buffer global de Room Service (sobrevive al cambio de módulo)
        this._pedidosPos = window._pedidosPosDesktop || [];
        this._pedidosPosEntregados = window._pedidosPosDesktopEntregados || [];
        window.RestauranteModule = this;
    },

    setupSocket() {
        if (!window.socket) return;
        window.socket.on('mesa:cambio', (data) => {
            this.cargarMesas();
            // Si la mesa que se liberó es la que está abierta en pantalla, limpiar el panel
            if (data.estado === 'LIBRE' && this.mesaSeleccionada && this.mesaSeleccionada.MesaID === data.mesaId) {
                this.mesaSeleccionada = null;
                this.resetUICompleto();
                window.Toast.fire({ icon: 'info', title: 'Mesa cerrada', text: 'Esta mesa fue cobrada', timer: 3000 });
            }
        });
        window.socket.on('cocina:item_listo', (data) => {
            Swal.fire({
                title: `🍽 LISTO PARA SERVIR`,
                html: `<b style="font-size:1.2rem;">${data.nombreProducto}</b><br><span style="color:#718096;">Mesa ${data.nroMesa} &nbsp;|&nbsp; Pedido #${data.nroOrden || ''}</span>`,
                icon: 'success',
                timer: 8000,
                timerProgressBar: true,
                position: 'top-end',
                toast: true,
                showConfirmButton: false
            });
            if (this.mesaSeleccionada && this.mesaSeleccionada.NroMesa == data.nroMesa && this.mesaSeleccionada.ComandaID) {
                this.cargarDetallePedido(this.mesaSeleccionada.ComandaID);
            }
            if (!document.getElementById('panel-cocina-desktop').classList.contains('hidden')) {
                this.cargarDatosCocina();
            }
        });
        window.socket.on('cocina:pedido_nuevo', () => {
            this.actualizarBadgeCocina();
            if (!document.getElementById('panel-cocina-desktop').classList.contains('hidden')) {
                this.cargarDatosCocina();
            }
        });
        window.socket.on('cocina:estado_cambio', () => {
            if (!document.getElementById('panel-cocina-desktop').classList.contains('hidden')) {
                this.cargarDatosCocina();
            }
        });
    },

    abrirPanelCocina() {
        // Siempre leer del buffer global por si llegaron eventos mientras se estaba en otro módulo
        this._pedidosPos = window._pedidosPosDesktop || [];
        this._pedidosPosEntregados = window._pedidosPosDesktopEntregados || [];
        document.getElementById('panel-cocina-desktop').classList.remove('hidden');
        this.cargarDatosCocina();
    },

    async actualizarBadgeCocina() {
        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const sedeId = localStorage.getItem('currentSedeId') || user.SedeID;
            const res = await api.get(`/restaurante/cocina/${sedeId}`);
            const pendientes = res.data.filter(p => p.Estado !== 'LISTO');
            const badge = document.getElementById('badge-cocina-desktop');
            if (badge) {
                badge.textContent = pendientes.length;
                badge.style.display = pendientes.length > 0 ? 'flex' : 'none';
            }
        } catch(e) {}
    },

    async cargarDatosCocina() {
        const lista = document.getElementById('cocina-lista-desktop');
        if (!lista) return;
        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const sedeId = localStorage.getItem('currentSedeId') || user.SedeID;
            const res = await api.get(`/restaurante/cocina/${sedeId}`);
            const todos      = res.data;
            const pedidos    = todos.filter(p => p.Estado !== 'LISTO');
            const entregados = todos.filter(p => p.Estado === 'LISTO');

            const countSol  = pedidos.filter(p => p.Estado === 'SOLICITADO').length;
            const countPrep = pedidos.filter(p => p.Estado === 'EN_PREPARACION').length;
            const countDem  = pedidos.filter(p => p.MinutosTranscurridos >= 15).length;

            document.getElementById('cocina-count-solicitado').textContent  = countSol;
            document.getElementById('cocina-count-preparacion').textContent = countPrep;
            document.getElementById('cocina-count-demorados').textContent   = countDem;

            const badge = document.getElementById('badge-cocina-desktop');
            if (badge) {
                badge.textContent = pedidos.length;
                badge.style.display = pedidos.length > 0 ? 'flex' : 'none';
            }

            const ahora = new Date();
            document.getElementById('cocina-ultima-actualizacion').textContent =
                `Actualizado: ${ahora.getHours().toString().padStart(2,'0')}:${ahora.getMinutes().toString().padStart(2,'0')}`;

            const renderFila = (p, esEntregado) => {
                const mins = p.MinutosTranscurridos || 0;
                const tiempo = mins < 1 ? 'Ahora' : mins < 60 ? `${mins} min` : `${Math.floor(mins/60)}h ${mins%60}m`;
                if (esEntregado) {
                    return `
                        <div style="background:var(--hotel-bg); border-radius:12px; padding:10px 15px; box-shadow:3px 3px 6px #bebebe,-3px -3px 6px #fff; border-left:3px solid #27ae60; display:flex; justify-content:space-between; align-items:center; opacity:0.8;">
                            <div style="display:flex; align-items:center; gap:10px;">
                                <span style="background:#27ae60; color:white; border-radius:5px; padding:1px 6px; font-size:0.65rem; font-weight:900;">#${p.NroOrden}</span>
                                <div>
                                    <span style="font-size:0.75rem; font-weight:900; color:#718096;">MESA ${p.NroMesa}</span>
                                    <span style="font-size:0.85rem; font-weight:700; color:#2d3748; margin-left:8px;">${p.NombreProducto}</span>
                                    <span style="font-size:0.75rem; color:#718096; margin-left:6px;">x${p.Cantidad}</span>
                                </div>
                            </div>
                            <div style="display:flex; align-items:center; gap:12px; flex-shrink:0;">
                                <span style="font-size:0.65rem; color:#718096;">${p.NombreUsuario}</span>
                                <span style="font-size:0.7rem; font-weight:900; color:#27ae60;"><i class="fas fa-check-circle"></i> hace ${tiempo}</span>
                            </div>
                        </div>`;
                }
                const alerta = mins >= 30 ? 'danger' : mins >= 15 ? 'warning' : 'ok';
                const colorBorde = alerta === 'danger' ? '#e74c3c' : alerta === 'warning' ? '#f39c12' : '#27ae60';
                const colorTiempo = alerta === 'danger' ? '#e74c3c' : alerta === 'warning' ? '#f39c12' : '#718096';
                const iconAlerta = alerta === 'danger' ? '<i class="fas fa-exclamation-triangle"></i> ' : alerta === 'warning' ? '<i class="fas fa-clock"></i> ' : '';
                const estadoLabel = p.Estado === 'EN_PREPARACION' ? 'EN PREPARACIÓN' : 'SOLICITADO';
                const estadoColor = p.Estado === 'EN_PREPARACION' ? '#f39c12' : '#e74c3c';
                return `
                    <div style="background:var(--hotel-bg); border-radius:15px; padding:15px 20px; box-shadow:4px 4px 8px #bebebe,-4px -4px 8px #fff; border-left:4px solid ${colorBorde}; display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <div style="font-size:0.65rem; font-weight:900; color:#718096; margin-bottom:4px;">
                                <span style="background:#1a365d; color:white; border-radius:5px; padding:2px 6px; margin-right:6px;">#${p.NroOrden}</span>
                                MESA ${p.NroMesa}
                                <span style="margin-left:8px; opacity:0.7;"><i class="fas fa-user"></i> ${p.NombreUsuario}</span>
                            </div>
                            <div style="font-size:1rem; font-weight:900; color:#1a365d;">${p.NombreProducto}</div>
                            <div style="font-size:0.8rem; color:#718096; margin-top:2px;">Cantidad: <strong>${p.Cantidad}</strong></div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:0.85rem; font-weight:900; color:${colorTiempo};">${iconAlerta}${tiempo}</div>
                            <div style="font-size:0.65rem; font-weight:900; color:${estadoColor}; margin-top:4px;">${estadoLabel}</div>
                        </div>
                    </div>`;
            };

            let html = '';
            if (pedidos.length === 0) {
                html += `<p style="text-align:center; opacity:0.4; padding:20px;"><i class="fas fa-check-circle" style="font-size:2rem; color:#27ae60; display:block; margin-bottom:8px;"></i>Sin pedidos pendientes</p>`;
            } else {
                html += pedidos.map(p => renderFila(p, false)).join('');
            }
            if (entregados.length > 0) {
                html += `<div style="margin:15px 0 10px; font-size:0.65rem; font-weight:900; color:#718096; letter-spacing:2px; text-transform:uppercase;"><i class="fas fa-check-circle" style="color:#27ae60;"></i> Entregados hoy (${entregados.length})</div>`;
                html += entregados.map(p => renderFila(p, true)).join('');
            }
            lista.innerHTML = html;
            this.renderPosDesktop();
        } catch(e) {
            lista.innerHTML = `<p style="text-align:center; color:#e74c3c;">Error al cargar cocina</p>`;
        }
    },

    renderPosDesktop() {
        const lista = document.getElementById('cocina-lista-desktop');
        if (!lista) return;

        const pendientes  = this._pedidosPos || [];
        const entregados  = this._pedidosPosEntregados || [];
        if (pendientes.length === 0 && entregados.length === 0) return;

        let html = '';

        if (pendientes.length > 0) {
            html += '<div style="margin:15px 0 10px; font-size:0.65rem; font-weight:900; color:#2980b9; letter-spacing:2px; text-transform:uppercase;"><i class="fas fa-concierge-bell"></i> Room Service / Lobby (' + pendientes.length + ')</div>';
            pendientes.forEach(function(p, idx) {
                html += '<div style="background:var(--hotel-bg); border-radius:15px; padding:12px 18px; box-shadow:4px 4px 8px #bebebe,-4px -4px 8px #fff; border-left:4px solid #2980b9; display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">'
                    + '<div>'
                    + '<div style="font-size:0.65rem; font-weight:900; color:#2980b9; margin-bottom:3px;"><i class="fas fa-concierge-bell"></i> ' + p.origen + '</div>'
                    + '<div style="font-size:0.95rem; font-weight:900; color:#1a365d;">' + p.nombreProducto + '</div>'
                    + '<div style="font-size:0.8rem; color:#718096;">Cantidad: <strong>' + p.cantidad + '</strong></div>'
                    + '</div>'
                    + '<button onclick="RestauranteModule.prepararPosDesktop(' + idx + ')" style="background:#2980b9; color:white; border:none; border-radius:10px; padding:8px 14px; font-weight:900; font-size:0.75rem; cursor:pointer;">'
                    + '<i class="fas fa-check"></i> PREPARADO</button>'
                    + '</div>';
            });
        }

        if (entregados.length > 0) {
            html += '<div style="margin:12px 0 8px; font-size:0.65rem; font-weight:900; color:#2980b9; letter-spacing:2px; text-transform:uppercase; opacity:0.7;"><i class="fas fa-check-circle"></i> Preparados Room Service (' + entregados.length + ')</div>';
            entregados.forEach(function(p) {
                html += '<div style="background:var(--hotel-bg); border-radius:12px; padding:10px 15px; box-shadow:3px 3px 6px #bebebe,-3px -3px 6px #fff; border-left:3px solid #2980b9; display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; opacity:0.75;">'
                    + '<div style="display:flex; align-items:center; gap:10px;">'
                    + '<i class="fas fa-check-circle" style="color:#2980b9;"></i>'
                    + '<div>'
                    + '<span style="font-size:0.75rem; font-weight:900; color:#718096;">' + p.origen + '</span>'
                    + '<span style="font-size:0.85rem; font-weight:700; color:#2d3748; margin-left:8px;">' + p.nombreProducto + '</span>'
                    + '<span style="font-size:0.75rem; color:#718096; margin-left:6px;">x' + p.cantidad + '</span>'
                    + '</div></div>'
                    + '<span style="font-size:0.7rem; font-weight:900; color:#2980b9;">LISTO</span>'
                    + '</div>';
            });
        }

        const existing = lista.querySelector('#pos-desktop-section');
        if (existing) existing.remove();
        const div = document.createElement('div');
        div.id = 'pos-desktop-section';
        div.innerHTML = html;
        lista.appendChild(div);
    },

    prepararPosDesktop(idx) {
        if (!this._pedidosPos) return;
        const item = this._pedidosPos.splice(idx, 1)[0];
        if (item) {
            this._pedidosPosEntregados.unshift(item);
            // Mantener sincronía con los buffers globales persistentes
            if (window._pedidosPosDesktop) window._pedidosPosDesktop.splice(idx, 1);
            if (window._pedidosPosDesktopEntregados) window._pedidosPosDesktopEntregados.unshift(item);
        }
        this.renderPosDesktop();
    },


    renderSedeSelector() {
        App.renderSedeSelector('sedeSelectorRestaurante', () => {
            this.cargarMesas();
            this.cargarInventarioVenta();
            this.resetUICompleto();
        });
    },

    async verificarCaja() {
        const user = JSON.parse(localStorage.getItem('user'));
        const sedeId = localStorage.getItem('currentSedeId') || user.SedeID;
        const res = await api.get(`/caja/estado/${user.UsuarioID}/${sedeId}`);
        this.cajaId = res.data.abierta ? res.data.caja.CajaID : null;
    },

    // ==========================================
    // CARGA Y RENDERIZADO DE MESAS
    // ==========================================
    async cargarMesas() {
        try {
            const sedeId = localStorage.getItem('currentSedeId') || JSON.parse(localStorage.getItem('user')).SedeID;
            const res = await api.get(`/restaurante/mesas/${sedeId}`);
            this.mesas = res.data;
            this.renderMesas();
        } catch (err) { console.error(err); }
    },

    renderMesas() {
        const grid = document.getElementById('grid-mesas');
        if (!grid) return;
        
        grid.innerHTML = this.mesas.map(m => {
            const status = m.Estado.toLowerCase();
            const ocupante = m.Huesped ? `<div style="font-size:0.55rem; color:var(--hotel-gold); font-weight:900; margin-top:5px; text-align:center;">${m.Huesped.split(' ')[0]}</div>` : '';
            
            const configBtn = this._isAdmin ? `
                <button onclick="event.stopPropagation(); RestauranteModule.abrirModalMesa(${m.MesaID})"
                        style="position:absolute; top:12px; right:12px; background:none; border:none; color:#718096; cursor:pointer; transition: color 0.2s;">
                    <i class="fas fa-cog"></i>
                </button>
            ` : '';

            return `
                <div class="mesa-card ${status}" onclick="RestauranteModule.seleccionarMesa(${m.MesaID})">
                    ${configBtn}
                    <div class="nro-mesa">${m.NroMesa}</div>
                    <div class="mesa-status">${m.Estado}</div>
                    ${ocupante}
                </div>
            `;
        }).join('');
    },

    async seleccionarMesa(id) {
        const mesa = this.mesas.find(m => m.MesaID === id);
        this.mesaSeleccionada = mesa;
        
        document.getElementById('ui-comanda-nro').textContent = `${mesa.NroMesa}`;
        document.getElementById('comanda-vacia').classList.add('hidden');
        document.getElementById('comanda-activa').classList.remove('hidden');

        if (mesa.Estado === 'LIBRE' || !mesa.ComandaID) {
            this.resetUIDetalle();
            
            if (mesa.Estado !== 'LIBRE') {
                window.Toast.fire({ 
                    icon: 'warning', 
                    title: 'MESA INCONSISTENTE', 
                    text: 'Esta mesa tiene un error en BD. Por favor use el botón de "ANULAR / RESETEAR MESA" para arreglarla.' 
                });
            }
        } else {
            await this.cargarDetallePedido(mesa.ComandaID);
        }
    },

    // ==========================================
    // GESTOR DE MESAS (CRUD)
    // ==========================================
    abrirModalMesa(mesaId = null) {
        if (!this._isAdmin) return;
        const form = document.getElementById('formMesa');
        if (form) form.reset();
        
        document.getElementById('in-mesa-id').value = '';
        const btnEliminar = document.getElementById('btn-eliminar-mesa');
        
        if (mesaId) {
            const mesa = this.mesas.find(m => m.MesaID === mesaId);
            if (mesa) {
                document.getElementById('in-mesa-id').value = mesa.MesaID;
                document.getElementById('in-mesa-nro').value = mesa.NroMesa;
                document.getElementById('in-mesa-capacidad').value = mesa.Capacidad || 2;
                
                if (btnEliminar) {
                    btnEliminar.style.display = 'flex';
                    btnEliminar.disabled = (mesa.Estado !== 'LIBRE'); 
                    btnEliminar.style.opacity = (mesa.Estado !== 'LIBRE') ? '0.5' : '1';
                }
            }
        } else {
            if (btnEliminar) btnEliminar.style.display = 'none';
        }
        
        document.getElementById('modalMesa').classList.remove('hidden');
    },

    cerrarModalMesa() {
        document.getElementById('modalMesa').classList.add('hidden');
    },

    async guardarMesa(e) {
        e.preventDefault();
        const sedeId = localStorage.getItem('currentSedeId') || JSON.parse(localStorage.getItem('user')).SedeID;
        
        const payload = {
            MesaID: document.getElementById('in-mesa-id').value || null,
            SedeID: sedeId,
            NroMesa: document.getElementById('in-mesa-nro').value.trim(),
            Capacidad: parseInt(document.getElementById('in-mesa-capacidad').value) || 2
        };

        try {
            const res = await api.post('/restaurante/mesas', payload);
            if (res.data.success) {
                window.Toast.fire({ icon: 'success', title: 'CONFIGURACIÓN GUARDADA' });
                this.cerrarModalMesa();
                await this.cargarMesas();
            }
        } catch (err) {
            window.Toast.fire({ icon: 'error', title: 'ERROR', text: err.response?.data?.error || 'No se pudo guardar la mesa' });
        }
    },

    async eliminarMesa() {
        const id = document.getElementById('in-mesa-id').value;
        if (!id) return;

        const confirm = await Swal.fire({
            title: '¿ELIMINAR MESA?',
            text: 'Esta acción retirará la mesa del mapa. No se puede deshacer.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: 'var(--hotel-danger)',
            cancelButtonColor: 'var(--hotel-blue)',
            confirmButtonText: 'SÍ, ELIMINAR'
        });

        if (confirm.isConfirmed) {
            try {
                const res = await api.delete(`/restaurante/mesas/${id}`);
                if (res.data.success) {
                    window.Toast.fire({ icon: 'success', title: 'MESA ELIMINADA' });
                    this.cerrarModalMesa();
                    
                    if (this.mesaSeleccionada && this.mesaSeleccionada.MesaID == id) {
                        this.resetUICompleto();
                    }
                    await this.cargarMesas();
                }
            } catch (err) {
                window.Toast.fire({ icon: 'error', title: 'ERROR', text: err.response?.data?.error || 'No se pudo eliminar' });
            }
        }
    },

    // ==========================================
    // GESTIÓN DE PRODUCTOS, CATEGORÍAS Y COMANDAS
    // ==========================================
    async cargarInventarioVenta() {
        const sedeId = localStorage.getItem('currentSedeId') || JSON.parse(localStorage.getItem('user')).SedeID;
        try {
            const res = await api.get(`/inventario/sede/${sedeId}`);
            this.productosCarta = res.data.filter(p => p.PrecioVenta > 0);
            this.extraerCategoriasActivas();
        } catch (err) {
            console.error("Error cargando inventario", err);
        }
    },

    extraerCategoriasActivas() {
        const mapaCategorias = new Map();
        this.productosCarta.forEach(p => {
            if (p.CategoriaID && p.CategoriaNombre) {
                mapaCategorias.set(p.CategoriaID, p.CategoriaNombre);
            }
        });
        
        this.categoriasCarta = Array.from(mapaCategorias, ([id, nombre]) => ({ id, nombre }));
    },

    renderFiltrosCategorias() {
        const container = document.getElementById('filtros-categorias');
        if (!container) return;

        let html = `<button class="btn-neo-filter ${this.categoriaFiltroActual === 'ALL' ? 'active' : ''}" onclick="RestauranteModule.filtrarPorCategoria('ALL')">TODOS</button>`;
        
        html += this.categoriasCarta.map(c => `
            <button class="btn-neo-filter ${this.categoriaFiltroActual === c.id ? 'active' : ''}" onclick="RestauranteModule.filtrarPorCategoria(${c.id})">${c.nombre}</button>
        `).join('');

        container.innerHTML = html;
    },

    filtrarPorCategoria(catId) {
        this.categoriaFiltroActual = catId;
        this.renderFiltrosCategorias();
        const textoBusqueda = document.getElementById('in-buscar-plato').value;
        this.renderProductosBusqueda(textoBusqueda);
    },

    abrirBuscadorPlatos() {
        if (!this.mesaSeleccionada) return;
        document.getElementById('modalPlatos').classList.remove('hidden');
        this.categoriaFiltroActual = 'ALL';
        this.renderFiltrosCategorias();
        this.renderProductosBusqueda();
        setTimeout(() => {
            const inB = document.getElementById('in-buscar-plato');
            inB.value = '';
            inB.focus();
        }, 100);
    },

    renderProductosBusqueda(q = '') {
        const grid = document.getElementById('grid-platos-pos');
        if (!grid) return;
        
        const filtrados = this.productosCarta.filter(p => {
            const coincideTexto = p.Nombre.toLowerCase().includes(q.toLowerCase()) || (p.CodigoBarras && p.CodigoBarras.includes(q));
            const coincideCategoria = this.categoriaFiltroActual === 'ALL' || p.CategoriaID === this.categoriaFiltroActual;
            return coincideTexto && coincideCategoria;
        });
        
        if (filtrados.length === 0) {
            grid.innerHTML = `<p style="grid-column: 1 / -1; text-align: center; color: #718096; margin-top: 20px;">No se encontraron productos.</p>`;
            return;
        }

        grid.innerHTML = filtrados.map(p => `
            <div class="room-card-rack" style="padding: 15px; text-align: center; border-left: none; cursor:pointer;" onclick="RestauranteModule.accionAgregarItem(${p.ProductoID})">
                <div style="font-weight:900; color:var(--hotel-blue); font-size:0.8rem; height:35px; overflow:hidden;">${p.Nombre}</div>
                <div style="color:var(--hotel-success); font-weight:900; margin-top:5px;">$${parseFloat(p.PrecioVenta).toFixed(2)}</div>
                <div style="font-size:0.6rem; opacity:0.6;">Stock: ${p.StockActual}</div>
            </div>
        `).join('');
    },

    async accionAgregarItem(prodId) {
    const prod = this.productosCarta.find(p => p.ProductoID === prodId);
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

        window.Toast.fire({ icon: 'success', title: 'Agregado', text: `${prod.Nombre}`, timer: 1000 });
        await this.cargarDetallePedido(this.mesaSeleccionada.ComandaID);
    } catch (e) { 
        console.error("Error capturado en restaurante:", e);
        
        // 🔍 Extraemos el mensaje real del backend (Ej: "STOCK INSUFICIENTE: ...")
        const mensajeError = e.response?.data?.error || 'Error al agregar producto a la comanda.';
        
        // Alerta elegante e informativa idéntica a la de Recepción
        Swal.fire({
            title: 'Control de Inventario',
            text: mensajeError,
            icon: 'warning',
            confirmButtonColor: 'var(--hotel-blue)',
            confirmButtonText: 'ENTENDIDO'
        });
    }
},

    async eliminarItemPedido(detalleId) {
        try {
            const res = await api.delete(`/restaurante/detalle/${detalleId}`);
            if (res.data.success) {
                window.Toast.fire({ icon: 'success', title: 'Ítem Removido', timer: 500 });
                await this.cargarDetallePedido(this.mesaSeleccionada.ComandaID);
            }
        } catch(e) {
            console.error(e);
            window.Toast.fire({ icon: 'error', title: 'Error al remover ítem' });
        }
    },

    async anularComandaActiva() {
        if (!this.mesaSeleccionada || !this.mesaSeleccionada.ComandaID) return;

        const confirm = await Swal.fire({
            title: '¿ANULAR COMANDA Y LIBERAR MESA?',
            text: 'Esta acción vaciará el pedido y reseteará la mesa a estado LIBRE. No se puede deshacer.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: 'var(--hotel-danger)',
            cancelButtonColor: 'var(--hotel-blue)',
            confirmButtonText: 'SÍ, RESETEAR MESA',
            cancelButtonText: 'CANCELAR',
            background: 'var(--hotel-bg)'
        });

        if (confirm.isConfirmed) {
            try {
                const res = await api.post('/restaurante/anular', { comandaId: this.mesaSeleccionada.ComandaID });
                if (res.data.success) {
                    window.Toast.fire({ icon: 'success', title: 'MESA RESETEADA CORRECTAMENTE' });
                    this.resetUICompleto();
                    await this.cargarMesas();
                }
            } catch (err) {
                window.Toast.fire({ icon: 'error', title: 'ERROR', text: err.response?.data?.error || 'No se pudo liberar la mesa' });
            }
        }
    },

    async cargarDetallePedido(comandaId) {
        try {
            const res = await api.get(`/restaurante/detalle/${comandaId}`);
            this.renderListaUI(res.data);
        } catch (e) { console.error(e); }
    },

    renderListaUI(items) {
        const box = document.getElementById('lista-platos-comanda');
        let t = 0;
        
        if (items.length === 0) {
            box.innerHTML = '<p style="text-align:center; opacity:0.5; margin-top:20px;">No hay productos registrados</p>';
            document.getElementById('ui-total-comanda').textContent = '$0.00';
            return;
        }

        box.innerHTML = items.map(i => {
            const sub = i.Cantidad * i.PrecioUnitario;
            t += sub;
            return `
                <div class="item-pedido">
                    <div style="font-size:0.8rem; flex:1;"><strong>${i.Cantidad}x</strong> ${i.NombreProducto}</div>
                    <div style="font-weight:900; margin-right: 15px; color: var(--hotel-blue);">$${sub.toFixed(2)}</div>
                    
                    <button type="button" onclick="RestauranteModule.eliminarItemPedido(${i.DetalleID})" style="background:none; border:none; color:var(--hotel-danger); cursor:pointer; padding:5px; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            `;
        }).join('');
        document.getElementById('ui-total-comanda').textContent = `$${t.toFixed(2)}`;
    },

    resetUIDetalle() {
        document.getElementById('lista-platos-comanda').innerHTML = '<p style="text-align:center; opacity:0.5; margin-top:20px;">Mesa lista para nuevo pedido</p>';
        document.getElementById('ui-total-comanda').textContent = '$0.00';
    },

    resetUICompleto() {
        document.getElementById('comanda-activa').classList.add('hidden');
        document.getElementById('comanda-vacia').classList.remove('hidden');
        this.mesaSeleccionada = null;
    },

    setupEventListeners() {
        const inB = document.getElementById('in-buscar-plato');
        if (inB) {
            inB.addEventListener('input', (e) => this.renderProductosBusqueda(e.target.value));
            inB.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const q = inB.value.trim().toLowerCase();
                    // Buscar coincidencia exacta de código de barras
                    let p = this.productosCarta.find(x => x.CodigoBarras === q);
                    // Si no, buscar el primer producto visible filtrado por nombre
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

        const formMesa = document.getElementById('formMesa');
        if (formMesa) {
            formMesa.onsubmit = (e) => this.guardarMesa(e);
        }
    },

    // ==========================================
    // SISTEMA DE COBROS MULTI-CANAL
    // ==========================================
    async finalizarCuenta() {
        if (!this.mesaSeleccionada || !this.mesaSeleccionada.ComandaID) return;

        const totalStr = document.getElementById('ui-total-comanda').textContent.replace('$', '');
        const total = parseFloat(totalStr);
        if (total <= 0) return window.Toast.fire({ icon: 'warning', title: 'La comanda está vacía' });

        const { value: tipoCobro } = await Swal.fire({
            title: '¿CÓMO PAGARÁ LA MESA?',
            html: `<p style="font-size:1.2rem; font-weight:bold; color:var(--hotel-blue); margin-bottom:15px;">TOTAL: $${total.toFixed(2)}</p>`,
            icon: 'question',
            showCancelButton: true,
            showDenyButton: true,
            confirmButtonText: '<i class="fas fa-bed"></i> CARGO A HABIT.',
            denyButtonText: '<i class="fas fa-cash-register"></i> CAJA (LOBBY)',
            cancelButtonText: 'CANCELAR',
            confirmButtonColor: 'var(--hotel-blue)',
            denyButtonColor: 'var(--hotel-success)',
            background: 'var(--hotel-bg)'
        });

        const user = JSON.parse(localStorage.getItem('user'));

        if (tipoCobro === true) {
            try {
                const resHabs = await api.get(`/recepcion/rack/${user.SedeID}`);
                const ocupadas = resHabs.data.filter(h => h.Estado === 'OCUPADA');
                
                if(ocupadas.length === 0) return Swal.fire('Sin Habitaciones', 'No hay habitaciones ocupadas actualmente.', 'info');

                let opcionesHabs = {};
                ocupadas.forEach(h => { opcionesHabs[h.RecepcionID] = `HAB. ${h.NroHabitacion} - ${h.Huesped}` });

                const { value: recepcionId } = await Swal.fire({
                    title: 'Seleccione la Habitación',
                    input: 'select',
                    inputOptions: opcionesHabs,
                    inputPlaceholder: 'Lista de Huéspedes',
                    showCancelButton: true,
                    confirmButtonColor: 'var(--hotel-blue)',
                });

                if (recepcionId) {
                    this.procesarCobroBackend({ comandaId: this.mesaSeleccionada.ComandaID, tipoCobro: 'HABITACION', recepcionId: recepcionId });
                }
            } catch(e) {
                console.error("Error cargando rack", e);
            }

        } else if (tipoCobro === false) {
            if (!this.cajaId) return Swal.fire({ icon: 'error', title: 'CAJA CERRADA', text: 'Debe abrir turno de caja para cobrar en efectivo/tarjetas.' });

            const { value: formPago } = await Swal.fire({
                title: 'COBRO EN RESTAURANTE',
                html: `
                    <label style="display:block; text-align:left; font-weight:bold; font-size:0.8rem; margin-bottom:5px;">Método de Pago</label>
                    <select id="res-metodo" class="swal2-input" style="margin-bottom:15px;" onchange="document.getElementById('res-box-voucher').style.display = (this.value == '2' || this.value == '3') ? 'block' : 'none'">
                        <option value="1">EFECTIVO</option>
                        <option value="2">TRANSFERENCIA</option>
                        <option value="3">TARJETA</option>
                    </select>

                    <label style="display:block; text-align:left; font-weight:bold; font-size:0.8rem; margin-bottom:5px;">Referencia (Opcional)</label>
                    <input id="res-ref" type="text" class="swal2-input" placeholder="Lote / Nro. Comprobante" style="margin-bottom:15px;">

                    <div id="res-box-voucher" style="display:none; text-align:left;">
                        <label style="display:block; font-weight:bold; font-size:0.8rem; margin-bottom:5px;">Foto del Comprobante</label>
                        <input id="res-voucher" type="file" class="swal2-file" accept="image/*,application/pdf">
                    </div>
                `,
                didOpen: () => { 
                    document.getElementById('res-metodo').dispatchEvent(new Event('change')); 
                },
                focusConfirm: false,
                showCancelButton: true,
                confirmButtonText: '<i class="fas fa-cash-register"></i> PROCESAR COBRO',
                confirmButtonColor: 'var(--hotel-success)',
                background: 'var(--hotel-bg)',
                preConfirm: () => {
                    return {
                        metodoPago: document.getElementById('res-metodo').value,
                        referencia: document.getElementById('res-ref').value,
                        voucherFile: document.getElementById('res-voucher').files[0]
                    }
                }
            });

            if (formPago) {
                // COMO HAY FOTO, USAMOS FORMDATA PARA EMPAQUETARLO
                const formData = new FormData();
                formData.append('comandaId', this.mesaSeleccionada.ComandaID);
                formData.append('tipoCobro', 'LOBBY');
                formData.append('cajaId', this.cajaId);
                formData.append('metodoPago', formPago.metodoPago);
                formData.append('referencia', formPago.referencia);
                formData.append('monto', total);
                
                if (formPago.voucherFile) {
                    formData.append('voucher', formPago.voucherFile);
                }

                this.procesarCobroBackend(formData); 
            }
        }
    },

    async procesarCobroBackend(payload) {
        try {
            // SI ES FORMDATA (Caja/Lobby) usamos headers de multipart, SI NO (Cargo a Habitación) pasa normal.
            const config = payload instanceof FormData ? { headers: { 'Content-Type': 'multipart/form-data' } } : {};
            
            const res = await api.post('/restaurante/cobrar', payload, config);
            
            if (res.data.success) {
                await Swal.fire({ icon: 'success', title: '¡CUENTA CERRADA!', text: 'Mesa liberada e inventario descontado.', confirmButtonColor: 'var(--hotel-blue)' });
                this.resetUICompleto();
                await this.cargarMesas();
            }
        } catch (err) {
            Swal.fire({ icon: 'error', title: 'Error al cobrar', text: err.response?.data?.error || 'Error de conexión' });
        }
    }
};

module.exports = RestauranteModule;