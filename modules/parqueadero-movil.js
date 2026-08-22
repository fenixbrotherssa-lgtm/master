const api = require('./api');

const ParqueaderoModule = {
    espacios: [],
    serviciosParqueo: [],
    huespedesActivos: [],
    cajaId: null,

    async init() {
        console.log("🚗 Módulo Parqueadero Móvil iniciado...");
        await this.verificarCaja();
        await this.cargarHuespedes();
        await this.cargarServiciosInventario();
        await this.cargarEspacios();
        this.setupEventListeners();
        this.setupSocket();
        window.ParqueaderoModule = this;
    },

    setupSocket() {
        if (!window.socket) return;
        window.socket.on('parqueadero:cambio', () => {
            this.cargarEspacios();
        });
    },

    getSedeId() {
        const user = JSON.parse(localStorage.getItem('user'));
        return localStorage.getItem('currentSedeId') || (user ? user.SedeID : 1);
    },

    async verificarCaja() {
        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const sedeId = this.getSedeId();
            const res = await api.get(`/caja/estado/${user.UsuarioID}/${sedeId}`);
            this.cajaId = res.data.abierta ? res.data.caja.CajaID : null;
        } catch(e) { console.warn("Caja no verificada", e); }
    },

    async cargarHuespedes() {
        try {
            const res = await api.get(`/recepcion/rack/${this.getSedeId()}`);
            this.huespedesActivos = res.data.filter(h => h.Estado === 'OCUPADA');
        } catch(e) { console.error("Error cargando rack", e); }
    },

    async cargarServiciosInventario() {
        try {
            const res = await api.get(`/inventario/sede/${this.getSedeId()}`);
            this.serviciosParqueo = res.data.filter(p => p.TipoItem === 'SERVICIO');
        } catch(e) { console.error("Error cargando servicios", e); }
    },

    // ==========================================
    // GRID DE ESPACIOS
    // ==========================================
    async cargarEspacios() {
        const grid = document.getElementById('grid-espacios');
        if (grid) grid.innerHTML = '<p style="grid-column:1/-1; text-align:center; opacity:0.5; padding:30px;">Cargando espacios...</p>';

        try {
            const res = await api.get(`/parqueadero/espacios/${this.getSedeId()}`);
            this.espacios = res.data;
            this.renderGrid();
        } catch (err) {
            window.Toast?.fire({ icon: 'error', title: 'Error cargando parqueadero' });
        }
    },

    renderGrid() {
        const gridContainer = document.getElementById('grid-espacios');
        if (!gridContainer) return;

        if (this.espacios.length === 0) {
            gridContainer.innerHTML = `
                <div style="grid-column:1/-1; text-align:center; padding:50px; opacity:0.5; font-weight:800;">
                    <i class="fas fa-parking" style="font-size:3rem; margin-bottom:15px; display:block;"></i>
                    SIN ESPACIOS CONFIGURADOS
                </div>`;
            return;
        }

        // Agrupar por zona
        const zonas = this.espacios.reduce((acc, e) => {
            const zona = e.Zona || 'PRINCIPAL';
            if (!acc[zona]) acc[zona] = [];
            acc[zona].push(e);
            return acc;
        }, {});

        let htmlFinal = '';
        for (const [nombreZona, espaciosDeZona] of Object.entries(zonas)) {
            const tarjetas = espaciosDeZona.map(e => {
                const estado = e.Estado.toLowerCase();
                const ocupada = estado.includes('ocupad');

                let icon = 'fa-car';
                if (e.TipoVehiculo === 'MOTO') icon = 'fa-motorcycle';
                if (e.TipoVehiculo === 'BUS') icon = 'fa-bus';
                if (e.TipoVehiculo === 'DISCAPACITADO') icon = 'fa-wheelchair';

                let infoOcupado = '';
                if (ocupada && e.Placa) {
                    const quien = e.HuespedNombre
                        ? `<div style="font-size:0.6rem; color:#1a365d; margin-top:4px; font-weight:bold;">${e.HuespedNombre}</div>`
                        : `<div style="font-size:0.6rem; color:#7f8c8d; margin-top:4px; font-weight:bold;">LOBBY</div>`;
                    infoOcupado = `
                        <div style="background:#e74c3c; color:white; padding:4px 10px; border-radius:10px;
                                    font-weight:900; margin-top:5px; font-family:monospace; font-size:0.85rem;">
                            ${e.Placa}
                        </div>${quien}`;
                }

                const borderColor = ocupada ? '#e74c3c' : (estado === 'mantenimiento' ? '#f39c12' : '#27ae60');
                const bgColor = ocupada ? '#fdf2f2' : '#e0e0e4';
                const iconColor = ocupada ? '#e74c3c' : '#27ae60';

                return `
                    <div onclick="ParqueaderoModule.gestionarClicEspacio(${e.EspacioID})"
                        style="background:${bgColor}; border-radius:20px; padding:20px 10px;
                               display:flex; flex-direction:column; align-items:center; justify-content:center;
                               cursor:pointer; box-shadow:6px 6px 12px #bebebe, -6px -6px 12px #ffffff;
                               border:4px solid ${borderColor};">
                        <i class="fas ${icon}" style="font-size:1.5rem; color:${iconColor}; opacity:0.8;"></i>
                        <div style="font-size:1.5rem; font-weight:900; color:#1a365d; margin:8px 0;">${e.CodigoEspacio}</div>
                        <div style="font-size:0.65rem; font-weight:800; text-transform:uppercase;">${e.Estado}</div>
                        ${infoOcupado}
                    </div>
                `;
            }).join('');

            htmlFinal += `
                <div style="grid-column:1/-1; margin-top:20px; margin-bottom:10px; border-bottom:2px solid #c5a059; padding-bottom:10px;">
                    <h3 style="color:#1a365d; margin:0; font-weight:900; text-transform:uppercase; font-size:0.9rem;">
                        <i class="fas fa-layer-group"></i> ÁREA: ${nombreZona}
                    </h3>
                </div>
                ${tarjetas}
            `;
        }

        gridContainer.innerHTML = htmlFinal;
    },

    // ==========================================
    // CLIC EN ESPACIO
    // ==========================================
    gestionarClicEspacio(id) {
        const espacio = this.espacios.find(e => e.EspacioID === id);
        if (!espacio) return;

        if (espacio.Estado === 'LIBRE') {
            this.abrirModalIngreso(espacio);
        } else if (espacio.Estado === 'OCUPADA' || espacio.Estado === 'OCUPADO') {
            this.abrirModalSalida(espacio);
        } else {
            Swal.fire('Mantenimiento', 'Este espacio no está operativo.', 'info');
        }
    },

    // ==========================================
    // MODAL INGRESO — abre con display flex
    // ==========================================
    abrirModalIngreso(espacio) {
        const form = document.getElementById('formIngreso');
        if (form) form.reset();

        document.getElementById('ing-espacio-id').value = espacio.EspacioID;
        document.getElementById('ing-ui-codigo').textContent = espacio.CodigoEspacio;

        const selectRec = document.getElementById('ing-recepcion');
        selectRec.innerHTML = '<option value="">-- CLIENTE EXTERNO (LOBBY) --</option>' +
            this.huespedesActivos.map(h =>
                `<option value="${h.RecepcionID}">Hab ${h.NroHabitacion} - ${h.Huesped}</option>`
            ).join('');

        const modal = document.getElementById('modalIngreso');
        modal.style.display = 'flex';   // <-- CORRECCIÓN: display flex directo

        setTimeout(() => {
            const inp = document.getElementById('ing-placa');
            if (inp) inp.focus();
        }, 100);
    },

    async registrarIngreso(e) {
        e.preventDefault();
        const user = JSON.parse(localStorage.getItem('user'));

        const payload = {
            EspacioID: document.getElementById('ing-espacio-id').value,
            SedeID: this.getSedeId(),
            UsuarioID: user.UsuarioID,
            Placa: document.getElementById('ing-placa').value.toUpperCase().trim(),
            RecepcionID: document.getElementById('ing-recepcion').value || null,
            Observaciones: document.getElementById('ing-obs').value
        };

        try {
            const res = await api.post('/parqueadero/ticket/entrada', payload);
            if (res.data.success) {
                window.Toast.fire({ icon: 'success', title: 'INGRESO REGISTRADO' });
                this.cerrarModales();
                await this.cargarEspacios();
            }
        } catch (err) {
            Swal.fire('Error', err.response?.data?.error || 'No se pudo registrar', 'error');
        }
    },

    // ==========================================
    // MODAL SALIDA — abre con display flex
    // ==========================================
    abrirModalSalida(espacio) {
        const form = document.getElementById('formSalida');
        if (form) form.reset();

        document.getElementById('out-ticket-id').value = espacio.TicketID;
        document.getElementById('out-ui-placa').textContent = espacio.Placa;

        const isHuesped = espacio.RecepcionID != null;
        document.getElementById('out-ui-huesped').textContent = isHuesped
            ? `HUÉSPED: ${espacio.HuespedNombre}`
            : 'CLIENTE EXTERNO (LOBBY)';

        // SQL Server manda la hora ya en hora local (sin Z, sin offset).
        // Al parsearla sin zona JS la trata como local → correcto.
        // Solo nos aseguramos de quitar la Z si por algún motivo viniera.
        const ingresoStr = (espacio.FechaIngreso || '').replace('Z', '').replace('+00:00', '');
        const ingreso = new Date(ingresoStr);

        // "Ahora" en local también, entonces la resta da el tiempo real transcurrido
        const ahora = new Date();
        const diffMs = ahora - ingreso;
        const diffHoras = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutos = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

        document.getElementById('out-ui-ingreso').textContent = ingreso.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        document.getElementById('out-ui-tiempo').textContent = `${diffHoras} hrs ${diffMinutos} min`;

        // Servicios
        const selectProd = document.getElementById('out-producto');
        selectProd.innerHTML = '<option value="">-- SELECCIONE SERVICIO --</option>' +
            this.serviciosParqueo.map(p =>
                `<option value="${p.ProductoID}" data-precio="${p.PrecioVenta}">${p.Nombre}</option>`
            ).join('');

        const boxMetodo = document.getElementById('box-metodo-pago');
        const btnProcesar = document.getElementById('btn-procesar-salida');

        if (isHuesped) {
            boxMetodo.style.display = 'none';
            btnProcesar.innerHTML = '<i class="fas fa-bed"></i> CARGAR A FOLIO Y LIBERAR';
            btnProcesar.style.background = '#c5a059';
        } else {
            boxMetodo.style.display = 'block';
            btnProcesar.innerHTML = '<i class="fas fa-cash-register"></i> COBRAR Y LIBERAR';
            btnProcesar.style.background = '#27ae60';
        }

        selectProd.onchange = (ev) => {
            const opt = ev.target.options[ev.target.selectedIndex];
            if (opt && opt.dataset.precio) {
                let sugerido = parseFloat(opt.dataset.precio);
                if (diffHoras > 0) sugerido = sugerido * diffHoras;
                document.getElementById('out-total').value = sugerido.toFixed(2);
            }
        };

        const modal = document.getElementById('modalSalida');
        modal.style.display = 'flex';   // <-- CORRECCIÓN: display flex directo
    },

    async registrarSalida(e) {
        e.preventDefault();

        const ticketId = document.getElementById('out-ticket-id').value;
        const total = parseFloat(document.getElementById('out-total').value) || 0;
        const productoId = document.getElementById('out-producto').value;
        const metodoId = document.getElementById('out-metodo').value;

        const espacio = this.espacios.find(x => x.TicketID == ticketId);
        if (!espacio) return Swal.fire('Error', 'No se encontró el ticket. Recargue el mapa.', 'error');

        const isHuesped = espacio.RecepcionID != null;
        const tipoCobro = isHuesped ? 'HABITACION' : 'LOBBY';

        if (!isHuesped && !this.cajaId && total > 0) {
            return Swal.fire('CAJA CERRADA', 'Debes abrir turno de caja para cobrar.', 'error');
        }
        if (!productoId && total > 0) {
            return Swal.fire('Atención', 'Seleccione el servicio de inventario a facturar.', 'warning');
        }

        const user = JSON.parse(localStorage.getItem('user'));
        const payload = {
            TicketID: ticketId,
            TipoCobro: tipoCobro,
            CajaID: this.cajaId,
            MetodoID: metodoId,
            TotalCobrado: total,
            ProductoID: productoId,
            UsuarioID: user.UsuarioID
        };

        try {
            const res = await api.post('/parqueadero/ticket/salida', payload);
            if (res.data.success) {
                await Swal.fire('Salida exitosa', 'Vehículo retirado y cuentas actualizadas.', 'success');
                this.cerrarModales();
                await this.cargarEspacios();
            }
        } catch (err) {
            Swal.fire('Error', err.response?.data?.error || 'Error al procesar salida', 'error');
        }
    },

    // ==========================================
    // CERRAR MODALES — usa display none
    // ==========================================
    cerrarModales() {
        // Cierra por ID directamente (más robusto que depender de clase)
        const ids = ['modalIngreso', 'modalSalida', 'modalConfigEspacio'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';  // <-- CORRECCIÓN: display none directo
        });
    },

    // ==========================================
    // EVENT LISTENERS
    // ==========================================
    setupEventListeners() {
        const formIn = document.getElementById('formIngreso');
        if (formIn) formIn.onsubmit = (e) => this.registrarIngreso(e);

        const formOut = document.getElementById('formSalida');
        if (formOut) formOut.onsubmit = (e) => this.registrarSalida(e);
    }
};

module.exports = ParqueaderoModule;