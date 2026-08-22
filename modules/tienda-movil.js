// modules/tienda-movil.js
// POS de venta directa (Tienda de Recepción).
// Reusa el motor productoCtrl.registrarVenta del backend: vende SIN mesa/comanda,
// cargando al folio de una habitación (RecepcionID) o cobrando en caja (lobby).
const api = require('./api');

// ⚠️ IMPORTANTE: confirma esta ruta contra tu archivo de rutas del backend.
// Es la ruta que mapea a productoCtrl.registrarVenta. La lista de productos ya
// usa '/inventario/sede/:id', así que lo más probable es que la venta sea
// '/inventario/venta'. Si en tus rutas es otra (p.ej. '/productos/venta' o
// '/ventas'), cambia SOLO esta constante.
const ENDPOINT_VENTA = '/inventario/venta';

const TiendaMovilModule = {
    productos: [],
    categorias: [],
    categoriaFiltro: 'ALL',
    carrito: [],            // [{ ProductoID, Nombre, PrecioVenta, Cantidad, StockActual }]
    huespedesActivos: [],
    cajaId: null,

    async init() {
        console.log("🛒 Módulo Tienda Móvil iniciado...");
        await this.verificarCaja();
        await this.cargarHuespedes();
        await this.cargarProductos();
        this.setupEventListeners();
        this.renderCarrito();
        this.setupSocket();
        window.TiendaMovilModule = this;
    },

    setupSocket() {
        if (!window.socket) return;
        window.socket.on('producto:stock', () => {
            this.cargarProductos();
        });
    },

    getUser() {
        return JSON.parse(localStorage.getItem('user'));
    },

    getSedeId() {
        const user = this.getUser();
        return localStorage.getItem('currentSedeId') || (user ? user.SedeID : 1);
    },

    async verificarCaja() {
        try {
            const user = this.getUser();
            const res = await api.get(`/caja/estado/${user.UsuarioID}/${this.getSedeId()}`);
            this.cajaId = res.data.abierta ? res.data.caja.CajaID : null;
        } catch (e) { console.warn("Caja no verificada", e); }

        // Pintar indicador de caja en la cabecera
        const badge = document.getElementById('tienda-caja-estado');
        if (badge) {
            if (this.cajaId) {
                badge.textContent = 'CAJA ABIERTA';
                badge.style.color = '#27ae60';
            } else {
                badge.textContent = 'CAJA CERRADA';
                badge.style.color = '#e74c3c';
            }
        }
    },

    async cargarHuespedes() {
        try {
            const res = await api.get(`/recepcion/rack/${this.getSedeId()}`);
            this.huespedesActivos = res.data.filter(h => h.Estado === 'OCUPADA');
        } catch (e) { console.error("Error cargando rack", e); }
    },

    // ==========================================
    // PRODUCTOS (mismo inventario que el restaurante)
    // ==========================================
    async cargarProductos() {
        try {
            const res = await api.get(`/inventario/sede/${this.getSedeId()}`);
            this.productos = res.data.filter(p => p.PrecioVenta > 0);
            this.extraerCategorias();
            this.renderFiltros();
            this.renderProductos();
        } catch (err) {
            console.error("Error cargando productos de tienda", err);
            if (window.Toast) window.Toast.fire({ icon: 'error', title: 'Error cargando inventario' });
        }
    },

    extraerCategorias() {
        const mapa = new Map();
        this.productos.forEach(p => {
            if (p.CategoriaID && p.CategoriaNombre) mapa.set(p.CategoriaID, p.CategoriaNombre);
        });
        this.categorias = Array.from(mapa, ([id, nombre]) => ({ id, nombre }));
    },

    renderFiltros() {
        const cont = document.getElementById('filtros-tienda');
        if (!cont) return;
        let html = `<button class="btn-neo-filter ${this.categoriaFiltro === 'ALL' ? 'active' : ''}" onclick="TiendaMovilModule.filtrar('ALL')">TODOS</button>`;
        html += this.categorias.map(c =>
            `<button class="btn-neo-filter ${this.categoriaFiltro === c.id ? 'active' : ''}" onclick="TiendaMovilModule.filtrar(${c.id})">${c.nombre}</button>`
        ).join('');
        cont.innerHTML = html;
    },

    filtrar(cat) {
        this.categoriaFiltro = cat;
        this.renderFiltros();
        const q = document.getElementById('in-buscar-tienda')?.value || '';
        this.renderProductos(q);
    },

    renderProductos(q = '') {
        const grid = document.getElementById('grid-tienda-productos');
        if (!grid) return;

        const filtrados = this.productos.filter(p => {
            const coincideTexto = p.Nombre.toLowerCase().includes(q.toLowerCase()) ||
                                  (p.CodigoBarras && p.CodigoBarras.includes(q));
            const coincideCat = this.categoriaFiltro === 'ALL' || p.CategoriaID === this.categoriaFiltro;
            return coincideTexto && coincideCat;
        });

        if (filtrados.length === 0) {
            grid.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:#718096; margin-top:20px;">Sin productos.</p>`;
            return;
        }

        grid.innerHTML = filtrados.map(p => {
            const sinStock = p.StockActual <= 0;
            return `
                <div onclick="${sinStock ? '' : `TiendaMovilModule.agregarAlCarrito(${p.ProductoID})`}"
                    style="background:#e0e0e4; border-radius:15px; padding:15px 10px; text-align:center;
                           cursor:${sinStock ? 'not-allowed' : 'pointer'}; opacity:${sinStock ? '0.45' : '1'};
                           box-shadow:5px 5px 10px #bebebe, -5px -5px 10px #ffffff;">
                    <div style="font-weight:900; color:#1a365d; font-size:0.85rem; margin-bottom:6px; line-height:1.2;">${p.Nombre}</div>
                    <div style="font-weight:900; color:#27ae60; font-size:1rem;">$${parseFloat(p.PrecioVenta).toFixed(2)}</div>
                    <div style="font-size:0.6rem; font-weight:800; color:${sinStock ? '#e74c3c' : '#718096'}; margin-top:5px;">
                        ${sinStock ? 'AGOTADO' : 'Stock: ' + p.StockActual}
                    </div>
                </div>
            `;
        }).join('');
    },

    // ==========================================
    // CARRITO
    // ==========================================
    agregarAlCarrito(productoId) {
        const prod = this.productos.find(p => p.ProductoID === productoId);
        if (!prod) return;

        const enCarrito = this.carrito.find(i => i.ProductoID === productoId);
        const cantActual = enCarrito ? enCarrito.Cantidad : 0;

        if (cantActual + 1 > prod.StockActual) {
            if (window.Toast) window.Toast.fire({ icon: 'warning', title: `Solo hay ${prod.StockActual} de ${prod.Nombre}` });
            return;
        }

        if (enCarrito) {
            enCarrito.Cantidad += 1;
        } else {
            this.carrito.push({
                ProductoID: prod.ProductoID,
                Nombre: prod.Nombre,
                PrecioVenta: parseFloat(prod.PrecioVenta),
                Cantidad: 1,
                StockActual: prod.StockActual
            });
        }
        this.renderCarrito();
        if (window.Toast) window.Toast.fire({ icon: 'success', title: `${prod.Nombre} agregado` });
    },

    cambiarCantidad(productoId, delta) {
        const item = this.carrito.find(i => i.ProductoID === productoId);
        if (!item) return;
        const nueva = item.Cantidad + delta;
        if (nueva <= 0) { this.quitarDelCarrito(productoId); return; }
        if (nueva > item.StockActual) {
            if (window.Toast) window.Toast.fire({ icon: 'warning', title: `Stock máximo: ${item.StockActual}` });
            return;
        }
        item.Cantidad = nueva;
        this.renderCarrito();
    },

    quitarDelCarrito(productoId) {
        this.carrito = this.carrito.filter(i => i.ProductoID !== productoId);
        this.renderCarrito();
    },

    vaciarCarrito() {
        this.carrito = [];
        this.renderCarrito();
    },

    totalCarrito() {
        return this.carrito.reduce((acc, i) => acc + (i.PrecioVenta * i.Cantidad), 0);
    },

    renderCarrito() {
        const total = this.totalCarrito();
        const numItems = this.carrito.reduce((acc, i) => acc + i.Cantidad, 0);

        // Barra inferior resumen
        const barTotal = document.getElementById('tienda-bar-total');
        const barItems = document.getElementById('tienda-bar-items');
        if (barTotal) barTotal.textContent = `$${total.toFixed(2)}`;
        if (barItems) barItems.textContent = `${numItems} ${numItems === 1 ? 'ítem' : 'ítems'}`;

        // Lista dentro del modal del carrito
        const lista = document.getElementById('lista-carrito-tienda');
        if (lista) {
            if (this.carrito.length === 0) {
                lista.innerHTML = `<p style="text-align:center; opacity:0.5; margin-top:25px;">Carrito vacío</p>`;
            } else {
                lista.innerHTML = this.carrito.map(i => {
                    const sub = i.PrecioVenta * i.Cantidad;
                    return `
                        <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px; padding:12px 15px;
                                    background:#e0e0e4; border-radius:15px; box-shadow:inset 3px 3px 6px #bebebe, inset -3px -3px 6px #ffffff;">
                            <div style="flex:1;">
                                <div style="font-size:0.85rem; font-weight:800; color:#1a365d;">${i.Nombre}</div>
                                <div style="font-size:0.7rem; color:#718096;">$${i.PrecioVenta.toFixed(2)} c/u</div>
                            </div>
                            <button onclick="TiendaMovilModule.cambiarCantidad(${i.ProductoID}, -1)"
                                style="width:32px; height:32px; border:none; border-radius:10px; background:#e0e0e4; color:#1a365d; font-weight:900; font-size:1.1rem; box-shadow:3px 3px 6px #bebebe, -3px -3px 6px #ffffff;">−</button>
                            <span style="min-width:24px; text-align:center; font-weight:900; color:#1a365d;">${i.Cantidad}</span>
                            <button onclick="TiendaMovilModule.cambiarCantidad(${i.ProductoID}, 1)"
                                style="width:32px; height:32px; border:none; border-radius:10px; background:#e0e0e4; color:#27ae60; font-weight:900; font-size:1.1rem; box-shadow:3px 3px 6px #bebebe, -3px -3px 6px #ffffff;">+</button>
                            <div style="min-width:60px; text-align:right; font-weight:900; color:#1a365d;">$${sub.toFixed(2)}</div>
                            <button onclick="TiendaMovilModule.quitarDelCarrito(${i.ProductoID})"
                                style="background:none; border:none; color:#e74c3c; cursor:pointer; font-size:1rem;"><i class="fas fa-trash-alt"></i></button>
                        </div>
                    `;
                }).join('');
            }
            const modalTotal = document.getElementById('ui-total-tienda');
            if (modalTotal) modalTotal.textContent = `$${total.toFixed(2)}`;
        }
    },

    abrirCarrito() {
        if (this.carrito.length === 0) {
            if (window.Toast) window.Toast.fire({ icon: 'info', title: 'El carrito está vacío' });
            return;
        }
        const modal = document.getElementById('modal-carrito-tienda');
        if (modal) modal.style.display = 'flex';
    },

    cerrarCarrito() {
        const modal = document.getElementById('modal-carrito-tienda');
        if (modal) modal.style.display = 'none';
    },

    // ==========================================
    // EVENTOS (búsqueda + escaneo por lector)
    // ==========================================
    setupEventListeners() {
        const inB = document.getElementById('in-buscar-tienda');
        if (inB) {
            inB.addEventListener('input', (e) => this.renderProductos(e.target.value));
            inB.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const q = inB.value.trim();
                    // 1) Coincidencia exacta por código de barras (lector USB/Bluetooth)
                    let p = this.productos.find(x => x.CodigoBarras === q);
                    // 2) Si no, primer producto que coincida por nombre en el filtro actual
                    if (!p) {
                        p = this.productos.find(x =>
                            (this.categoriaFiltro === 'ALL' || x.CategoriaID === this.categoriaFiltro) &&
                            x.Nombre.toLowerCase().includes(q.toLowerCase())
                        );
                    }
                    if (p) { this.agregarAlCarrito(p.ProductoID); inB.value = ''; this.renderProductos(''); }
                }
            });
        }
    },

    // ==========================================
    // COBRO (igual que recepción: folio o caja)
    // ==========================================
    async cobrar() {
        if (this.carrito.length === 0) {
            return window.Toast.fire({ icon: 'warning', title: 'Carrito vacío' });
        }
        const total = this.totalCarrito();
        const user = this.getUser();

        const result = await Swal.fire({
            title: '¿CÓMO SE COBRA?',
            html: `<p style="font-size:1.3rem; font-weight:900; color:#1a365d; margin:5px 0;">TOTAL: $${total.toFixed(2)}</p>`,
            icon: 'question',
            showCancelButton: true,
            showDenyButton: true,
            confirmButtonText: '<i class="fas fa-bed"></i> CARGO A HABITACIÓN',
            denyButtonText: '<i class="fas fa-cash-register"></i> EFECTIVO / CAJA',
            cancelButtonText: 'CANCELAR',
            confirmButtonColor: '#1a365d',
            denyButtonColor: '#27ae60'
        });

        // --- CARGO A HABITACIÓN (folio) ---
        if (result.isConfirmed) {
            if (this.huespedesActivos.length === 0) {
                return Swal.fire('Sin huéspedes', 'No hay habitaciones ocupadas para cargar el consumo.', 'info');
            }
            let opciones = {};
            this.huespedesActivos.forEach(h => { opciones[h.RecepcionID] = `HAB. ${h.NroHabitacion} - ${h.Huesped}`; });

            const { value: recepcionId } = await Swal.fire({
                title: 'Cargar a la habitación',
                input: 'select',
                inputOptions: opciones,
                inputPlaceholder: 'Seleccione huésped',
                showCancelButton: true,
                confirmButtonColor: '#1a365d'
            });

            if (recepcionId) {
                await this.procesarVenta({
                    SedeID: this.getSedeId(),
                    UsuarioID: user.UsuarioID,
                    RecepcionID: recepcionId,
                    carrito: this.carritoParaBackend()
                });
            }

        // --- COBRO INMEDIATO EN CAJA (lobby) ---
        } else if (result.isDenied) {
            if (!this.cajaId) {
                return Swal.fire({ icon: 'error', title: 'CAJA CERRADA', text: 'Debe abrir turno de caja para cobrar en efectivo.' });
            }

            // Guardamos aquí el archivo de comprobante seleccionado (solo transf./tarjeta)
            this._voucherFile = null;

            const { value: formPago } = await Swal.fire({
                title: 'COBRO EN TIENDA',
                html: `
                    <label style="display:block; text-align:left; font-weight:bold; font-size:0.8rem; margin-bottom:5px;">Método de Pago</label>
                    <select id="tienda-metodo" class="swal2-input" style="margin-bottom:15px;">
                        <option value="1">EFECTIVO</option>
                        <option value="2">TRANSFERENCIA</option>
                        <option value="3">TARJETA</option>
                    </select>
                    <label style="display:block; text-align:left; font-weight:bold; font-size:0.8rem; margin-bottom:5px;">Referencia (Opcional)</label>
                    <input id="tienda-ref" type="text" class="swal2-input" placeholder="Lote / Nro. Comprobante">

                    <!-- Bloque de comprobante: oculto por defecto, solo para transferencia/tarjeta -->
                    <div id="tienda-box-voucher" style="display:none; margin-top:15px;">
                        <label style="display:block; text-align:left; font-weight:bold; font-size:0.8rem; margin-bottom:8px;">Comprobante (foto o archivo)</label>
                        <input type="file" id="tienda-voucher" accept="image/*" capture="environment" style="display:none;">
                        <button type="button" id="tienda-btn-voucher"
                            style="width:100%; padding:14px; border:none; border-radius:12px; background:#1a365d; color:#fff; font-weight:900; cursor:pointer;">
                            <i class="fas fa-camera"></i> TOMAR / CARGAR FOTO
                        </button>
                        <img id="tienda-voucher-preview" src="" alt=""
                            style="display:none; width:100%; max-height:160px; object-fit:contain; margin-top:12px; border-radius:12px; box-shadow:inset 3px 3px 6px #bebebe, inset -3px -3px 6px #ffffff;">
                    </div>
                `,
                focusConfirm: false,
                showCancelButton: true,
                confirmButtonText: 'PROCESAR COBRO',
                confirmButtonColor: '#27ae60',
                didOpen: () => {
                    const selMetodo = document.getElementById('tienda-metodo');
                    const boxVoucher = document.getElementById('tienda-box-voucher');
                    const inputFile = document.getElementById('tienda-voucher');
                    const btnFile = document.getElementById('tienda-btn-voucher');
                    const preview = document.getElementById('tienda-voucher-preview');

                    // Mostrar el bloque de comprobante solo en transferencia (2) o tarjeta (3)
                    const toggleVoucher = () => {
                        const requiere = selMetodo.value === '2' || selMetodo.value === '3';
                        boxVoucher.style.display = requiere ? 'block' : 'none';
                        if (!requiere) {
                            this._voucherFile = null;
                            inputFile.value = '';
                            preview.style.display = 'none';
                        }
                    };
                    selMetodo.addEventListener('change', toggleVoucher);

                    btnFile.addEventListener('click', () => inputFile.click());
                    inputFile.addEventListener('change', (e) => {
                        const file = e.target.files[0];
                        this._voucherFile = file || null;
                        if (file) {
                            preview.src = URL.createObjectURL(file);
                            preview.style.display = 'block';
                            btnFile.innerHTML = '<i class="fas fa-check"></i> COMPROBANTE LISTO';
                        }
                    });

                    toggleVoucher();
                },
                preConfirm: () => {
                    const metodo = document.getElementById('tienda-metodo').value;
                    // En transferencia/tarjeta exigimos el comprobante
                    if ((metodo === '2' || metodo === '3') && !this._voucherFile) {
                        Swal.showValidationMessage('Adjunte la foto del comprobante para transferencia/tarjeta.');
                        return false;
                    }
                    return {
                        MetodoID: metodo,
                        Referencia: document.getElementById('tienda-ref').value
                    };
                }
            });

            if (formPago) {
                // Si hay comprobante (transf./tarjeta) mandamos FormData; si no, JSON normal.
                if (this._voucherFile) {
                    const fd = new FormData();
                    fd.append('SedeID', this.getSedeId());
                    fd.append('UsuarioID', user.UsuarioID);
                    fd.append('CajaID', this.cajaId);
                    fd.append('RecepcionID', '');
                    fd.append('carrito', JSON.stringify(this.carritoParaBackend()));
                    fd.append('pagoInmediato', JSON.stringify({
                        Monto: total,
                        MetodoID: formPago.MetodoID,
                        Referencia: formPago.Referencia
                    }));
                    fd.append('voucher', this._voucherFile);
                    await this.procesarVenta(fd);
                } else {
                    await this.procesarVenta({
                        SedeID: this.getSedeId(),
                        UsuarioID: user.UsuarioID,
                        CajaID: this.cajaId,
                        RecepcionID: null,
                        carrito: this.carritoParaBackend(),
                        pagoInmediato: {
                            Monto: total,
                            MetodoID: formPago.MetodoID,
                            Referencia: formPago.Referencia
                        }
                    });
                }
            }
            this._voucherFile = null;
        }
    },

    // El backend solo necesita estos campos por ítem
    carritoParaBackend() {
        return this.carrito.map(i => ({
            ProductoID: i.ProductoID,
            Cantidad: i.Cantidad,
            PrecioVenta: i.PrecioVenta,
            EsCortesia: 0
        }));
    },

    async procesarVenta(payload) {
        try {
            // Si es FormData (lleva voucher), axios necesita el header multipart.
            const config = payload instanceof FormData
                ? { headers: { 'Content-Type': 'multipart/form-data' } }
                : {};
            const res = await api.post(ENDPOINT_VENTA, payload, config);
            if (res.data.success) {
                await Swal.fire({ icon: 'success', title: '¡VENTA REGISTRADA!', text: 'Inventario y cuentas actualizados.' });
                this.vaciarCarrito();
                this.cerrarCarrito();
                await this.cargarProductos(); // refresca stock
            }
        } catch (err) {
            Swal.fire({ icon: 'error', title: 'Error en la venta', text: err.response?.data?.error || 'Error de conexión' });
        }
    }
};

module.exports = TiendaMovilModule;