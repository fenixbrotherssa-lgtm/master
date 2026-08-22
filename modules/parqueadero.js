const api = require('./api');

const ParqueaderoModule = {
    espacios: [],
    serviciosParqueo: [],
    huespedesActivos: [],
    cajaId: null,

    async init() {
        console.log("🚗 Módulo Parqueadero Iniciado...");

        const user = JSON.parse(localStorage.getItem('user'));
        this._isAdmin = user && parseInt(user.RolID) === 1;

        // Ocultar controles de administración para usuarios no admin
        if (!this._isAdmin) {
            const btnCrear = document.querySelector('button[onclick="ParqueaderoModule.abrirModalConfig()"]');
            if (btnCrear) btnCrear.style.display = 'none';
        }

        // 1. RENDERIZAR SELECTOR DE SEDES (LA CLAVE MULTISUCURSAL)
        this.renderSedeSelector();

        // 2. Cargar dependencias iniciales
        await this.verificarCaja();
        await this.cargarHuespedes();
        await this.cargarServiciosInventario();

        // 3. Cargar mapa de espacios físicos
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

    // --- NUEVO: SELECTOR DE SEDE ---
    renderSedeSelector() {
        // Usamos la función global de tu framework (App.js)
        App.renderSedeSelector('sedeSelectorParqueadero', async () => {
            // Cuando el usuario cambia de sede, recargamos TODO el contexto
            await this.verificarCaja();
            await this.cargarHuespedes();
            await this.cargarServiciosInventario();
            await this.cargarEspacios();
        });
    },

    // --- HELPER: OBTENER SEDE ACTIVA ---
    getSedeId() {
        const selector = document.getElementById('globalSedeSelector');
        if (selector) return selector.value;
        const user = JSON.parse(localStorage.getItem('user'));
        return localStorage.getItem('currentSedeId') || (user ? user.SedeID : 1);
    },

    async verificarCaja() {
        const user = JSON.parse(localStorage.getItem('user'));
        const sedeId = this.getSedeId();
        try {
            const res = await api.get(`/caja/estado/${user.UsuarioID}/${sedeId}`);
            this.cajaId = res.data.abierta ? res.data.caja.CajaID : null;
        } catch(e) { console.warn("Caja no verificada", e); }
    },

    async cargarHuespedes() {
        const sedeId = this.getSedeId();
        try {
            const res = await api.get(`/recepcion/rack/${sedeId}`);
            // Filtramos solo habitaciones ocupadas de esta sede
            this.huespedesActivos = res.data.filter(h => h.Estado === 'OCUPADA');
        } catch(e) { console.error("Error cargando Rack para Parqueadero", e); }
    },

    async cargarServiciosInventario() {
        const sedeId = this.getSedeId();
        try {
            const res = await api.get(`/inventario/sede/${sedeId}`);
            // Filtramos solo los ítems marcados como SERVICIO en esta sede
            this.serviciosParqueo = res.data.filter(p => p.TipoItem === 'SERVICIO');
        } catch(e) { console.error("Error cargando servicios", e); }
    },

    async cargarEspacios() {
        const sedeId = this.getSedeId();
        const grid = document.getElementById('grid-espacios');
        if (grid) grid.innerHTML = '<p style="grid-column: 1/-1; text-align:center; opacity:0.5;">Cargando espacios...</p>';

        try {
            const res = await api.get(`/parqueadero/espacios/${sedeId}`);
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
            gridContainer.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:50px; opacity:0.5; font-weight:800;">
                <i class="fas fa-parking" style="font-size:3rem; margin-bottom:15px; display:block;"></i>
                NO HAY ESPACIOS CONFIGURADOS EN ESTA SEDE
            </div>`;
            return;
        }

        // 1. AGRUPAR ESPACIOS POR ZONA (Múltiples parqueaderos en una misma sede)
        const zonas = this.espacios.reduce((acc, espacio) => {
            const zonaNombre = espacio.Zona || 'PRINCIPAL';
            if (!acc[zonaNombre]) acc[zonaNombre] = [];
            acc[zonaNombre].push(espacio);
            return acc;
        }, {});

        // 2. RENDERIZAR CADA ZONA CON SU TÍTULO Y GRID INDEPENDIENTE
        let htmlFinal = '';

        for (const [nombreZona, espaciosDeZona] of Object.entries(zonas)) {
            // Generar tarjetas para esta zona específica
            const tarjetasHtml = espaciosDeZona.map(e => {
                const estado = e.Estado.toLowerCase(); 
                
                let icon = 'fa-car';
                if (e.TipoVehiculo === 'MOTO') icon = 'fa-motorcycle';
                if (e.TipoVehiculo === 'BUS') icon = 'fa-bus';
                if (e.TipoVehiculo === 'DISCAPACITADO') icon = 'fa-wheelchair';

                let infoOcupado = '';
                if ((estado === 'ocupada' || estado === 'ocupado') && e.Placa) {
                    const huesped = e.HuespedNombre ? `<div style="font-size:0.6rem; color:var(--hotel-blue); margin-top:5px; font-weight:bold;">${e.HuespedNombre}</div>` : `<div style="font-size:0.6rem; color:#7f8c8d; margin-top:5px; font-weight:bold;">LOBBY</div>`;
                    infoOcupado = `<div class="placa-badge">${e.Placa}</div>${huesped}`;
                }

                return `
                    <div class="espacio-card ${estado}" onclick="ParqueaderoModule.gestionarClicEspacio(${e.EspacioID})">
                        ${this._isAdmin ? `<button class="btn-config no-print" onclick="event.stopPropagation(); ParqueaderoModule.abrirModalConfig(${e.EspacioID})"><i class="fas fa-cog"></i></button>` : ''}
                        <i class="fas ${icon}" style="font-size: 1.5rem; color: ${estado.includes('ocupad') ? 'var(--hotel-danger)' : 'var(--hotel-success)'}; opacity:0.8;"></i>
                        <div class="nro-espacio">${e.CodigoEspacio}</div>
                        <div class="espacio-status">${e.Estado}</div>
                        ${infoOcupado}
                    </div>
                `;
            }).join('');

            // Agregar el separador visual de la Zona y su grid de tarjetas
            htmlFinal += `
                <div style="grid-column: 1/-1; margin-top: 20px; margin-bottom: 10px; border-bottom: 2px solid var(--hotel-gold); padding-bottom: 10px;">
                    <h3 style="color: var(--hotel-blue); margin: 0; font-weight: 900; text-transform: uppercase;">
                        <i class="fas fa-layer-group"></i> ÁREA / ZONA: ${nombreZona}
                    </h3>
                </div>
                ${tarjetasHtml}
            `;
        }

        // Inyectar todo al grid base
        gridContainer.innerHTML = htmlFinal;
    },

    // ==========================================
    // LÓGICA DE CONTROL (CLICS EN EL GRID)
    // ==========================================
    gestionarClicEspacio(id) {
        const espacio = this.espacios.find(e => e.EspacioID === id);
        if (!espacio) return;

        if (espacio.Estado === 'LIBRE') {
            this.abrirModalIngreso(espacio);
        } else if (espacio.Estado === 'OCUPADA' || espacio.Estado === 'OCUPADO') {
            this.abrirModalSalida(espacio);
        } else {
            Swal.fire('Mantenimiento', 'Este espacio no está operativo actualmente.', 'info');
        }
    },

    // ==========================================
    // FLUJO: INGRESO DE VEHÍCULO
    // ==========================================
    abrirModalIngreso(espacio) {
        const form = document.getElementById('formIngreso');
        form.reset();
        document.getElementById('ing-espacio-id').value = espacio.EspacioID;
        document.getElementById('ing-ui-codigo').textContent = espacio.CodigoEspacio;

        // Llenar selector de huéspedes (Rack de la Sede Actual)
        const selectRec = document.getElementById('ing-recepcion');
        selectRec.innerHTML = '<option value="">-- CLIENTE EXTERNO (LOBBY) --</option>' +
            this.huespedesActivos.map(h => `<option value="${h.RecepcionID}">Hab ${h.NroHabitacion} - ${h.Huesped}</option>`).join('');

        document.getElementById('modalIngreso').classList.remove('hidden');
        setTimeout(() => document.getElementById('ing-placa').focus(), 100);
    },

    async registrarIngreso(e) {
        e.preventDefault();
        const user = JSON.parse(localStorage.getItem('user'));
        const sedeId = this.getSedeId(); // Usar la sede seleccionada

        const payload = {
            EspacioID: document.getElementById('ing-espacio-id').value,
            SedeID: sedeId,
            UsuarioID: user.UsuarioID,
            Placa: document.getElementById('ing-placa').value.toUpperCase(),
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
    // FLUJO: SALIDA Y COBRO
    // ==========================================
    abrirModalSalida(espacio) {
        const form = document.getElementById('formSalida');
        form.reset();

        document.getElementById('out-ticket-id').value = espacio.TicketID;
        document.getElementById('out-ui-placa').textContent = espacio.Placa;
        
        const isHuesped = espacio.RecepcionID != null;
        document.getElementById('out-ui-huesped').textContent = isHuesped 
            ? `VINCULADO A HUÉSPED: ${espacio.HuespedNombre}` 
            : `CLIENTE EXTERNO (LOBBY)`;

        // 🔴 SOLUCIÓN AL DESFASE DE ZONA HORARIA:
        // Si el string de la base de datos finaliza en 'Z', se remueve para parsearlo en tiempo local.
        let fechaIngresoStr = espacio.FechaIngreso;
        if (typeof fechaIngresoStr === 'string' && fechaIngresoStr.endsWith('Z')) {
            fechaIngresoStr = fechaIngresoStr.slice(0, -1);
        }

        const ingreso = new Date(fechaIngresoStr);
        const ahora = new Date();
        const diffMs = ahora - ingreso;
        
        // Evita cálculos negativos por desajustes milimétricos del reloj cliente/servidor
        const diffMsAbs = Math.max(0, diffMs);

        const diffHoras = Math.floor(diffMsAbs / (1000 * 60 * 60));
        const diffMinutos = Math.floor((diffMsAbs % (1000 * 60 * 60)) / (1000 * 60));
        
        document.getElementById('out-ui-ingreso').textContent = ingreso.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        document.getElementById('out-ui-tiempo').textContent = `${diffHoras} hrs ${diffMinutos} min`;

        // Configurar Cobro (Servicios de la sede actual)
        const selectProd = document.getElementById('out-producto');
        selectProd.innerHTML = '<option value="">-- SELECCIONE SERVICIO DE INVENTARIO --</option>' +
            this.serviciosParqueo.map(p => `<option value="${p.ProductoID}" data-precio="${p.PrecioVenta}">${p.Nombre}</option>`).join('');

        const boxMetodo = document.getElementById('box-metodo-pago');
        const btnProcesar = document.getElementById('btn-procesar-salida');
        const boxVoucher = document.getElementById('box-voucher-salida');
        const metodoSelect = document.getElementById('out-metodo');

        if (isHuesped) {
            boxMetodo.style.display = 'none';
            boxVoucher.style.display = 'none';
            btnProcesar.innerHTML = '<i class="fas fa-bed"></i> CARGAR A FOLIO Y LIBERAR';
            btnProcesar.style.background = 'var(--hotel-gold)';
        } else {
            boxMetodo.style.display = 'block';
            btnProcesar.innerHTML = '<i class="fas fa-cash-register"></i> COBRAR Y LIBERAR';
            btnProcesar.style.background = 'var(--hotel-success)';
        }

        // Comprobante solo aplica a cobro externo pagado con transferencia/tarjeta
        metodoSelect.onchange = () => {
            const requiereVoucher = !isHuesped && (metodoSelect.value === '2' || metodoSelect.value === '3');
            boxVoucher.style.display = requiereVoucher ? 'block' : 'none';
        };
        metodoSelect.onchange();

        selectProd.onchange = (e) => {
            const opt = e.target.options[e.target.selectedIndex];
            if (opt && opt.dataset.precio) {
                let sugerido = parseFloat(opt.dataset.precio);
                if (diffHoras > 0) sugerido = sugerido * diffHoras; // Lógica básica (Ajustable)
                document.getElementById('out-total').value = sugerido.toFixed(2);
            }
        };

        document.getElementById('modalSalida').classList.remove('hidden');
    },

    async registrarSalida(e) {
        e.preventDefault();
        
        const ticketId = document.getElementById('out-ticket-id').value;
        const total = parseFloat(document.getElementById('out-total').value) || 0;
        const productoId = document.getElementById('out-producto').value;
        const metodoId = document.getElementById('out-metodo').value;
        
        const espacio = this.espacios.find(x => x.TicketID == ticketId);
        if (!espacio) return;
        
        const isHuesped = espacio.RecepcionID != null;
        const tipoCobro = isHuesped ? 'HABITACION' : 'LOBBY';

        if (!isHuesped && !this.cajaId && total > 0) {
            return Swal.fire('CAJA CERRADA', 'Debes abrir turno de caja para cobrar a un cliente externo.', 'error');
        }

        if (!productoId && total > 0) {
            return Swal.fire('Atención', 'Debe seleccionar el servicio de inventario a facturar.', 'warning');
        }

        const user = JSON.parse(localStorage.getItem('user'));
        const referencia = document.getElementById('out-referencia')?.value || '';
        const voucherInput = document.getElementById('out-voucher');
        const voucherFile = (voucherInput && voucherInput.files) ? voucherInput.files[0] : null;

        const formData = new FormData();
        formData.append('TicketID', ticketId);
        formData.append('TipoCobro', tipoCobro);
        formData.append('CajaID', this.cajaId || '');
        formData.append('MetodoID', metodoId);
        formData.append('TotalCobrado', total);
        formData.append('ProductoID', productoId);
        formData.append('UsuarioID', user.UsuarioID);
        formData.append('Referencia', referencia);
        if (voucherFile) formData.append('voucher', voucherFile);

        try {
            const res = await api.post('/parqueadero/ticket/salida', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
            if (res.data.success) {
                await Swal.fire('Salida Exitosa', 'Vehículo retirado y cuentas actualizadas.', 'success');
                this.cerrarModales();
                await this.cargarEspacios();
            }
        } catch (err) {
            Swal.fire('Error', err.response?.data?.error || 'Error al procesar salida', 'error');
        }
    },

    // ==========================================
    // CRUD ESPACIOS (CONFIGURACIÓN)
    // ==========================================
    abrirModalConfig(id = null) {
        if (!this._isAdmin) return;
        const form = document.getElementById('formConfigEspacio');
        form.reset();
        document.getElementById('cfg-id').value = '';
        document.getElementById('cfg-zona').value = 'PRINCIPAL';
        
        const btnDel = document.getElementById('btn-eliminar-espacio');

        if (id) {
            const espacio = this.espacios.find(e => e.EspacioID === id);
            document.getElementById('cfg-id').value = espacio.EspacioID;
            document.getElementById('cfg-codigo').value = espacio.CodigoEspacio;
            document.getElementById('cfg-zona').value = espacio.Zona || 'PRINCIPAL';
            document.getElementById('cfg-tipo').value = espacio.TipoVehiculo;
            document.getElementById('cfg-estado').value = espacio.Estado;
            
            btnDel.style.display = 'block';
            btnDel.disabled = (!espacio.Estado.includes('LIBRE') && !espacio.Estado.includes('MANTENIMIENTO'));
            btnDel.style.opacity = btnDel.disabled ? '0.5' : '1';
        } else {
            btnDel.style.display = 'none';
        }

        document.getElementById('modalConfigEspacio').classList.remove('hidden');
    },

    async guardarEspacioConfig(e) {
        e.preventDefault();
        const sedeId = this.getSedeId(); // Asegurarse de guardar en la sede actual del selector

        const payload = {
            EspacioID: document.getElementById('cfg-id').value || null,
            SedeID: sedeId,
            CodigoEspacio: document.getElementById('cfg-codigo').value.toUpperCase(),
            Zona: document.getElementById('cfg-zona').value.toUpperCase(), // Se envía la zona en mayúsculas
            TipoVehiculo: document.getElementById('cfg-tipo').value,
            Estado: document.getElementById('cfg-estado').value
        };

        try {
            const res = await api.post('/parqueadero/espacios', payload);
            if (res.data.success) {
                window.Toast.fire({ icon: 'success', title: 'ESPACIO GUARDADO' });
                this.cerrarModales();
                await this.cargarEspacios();
            }
        } catch (err) {
            Swal.fire('Error', err.response?.data?.error || 'No se pudo guardar', 'error');
        }
    },

    async eliminarEspacio() {
        const id = document.getElementById('cfg-id').value;
        if (!id) return;

        const confirm = await Swal.fire({
            title: '¿ELIMINAR ESPACIO?',
            text: 'Esta acción borrará el espacio físico del mapa.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: 'var(--hotel-danger)',
            confirmButtonText: 'SÍ, ELIMINAR'
        });

        if (confirm.isConfirmed) {
            try {
                const res = await api.delete(`/parqueadero/espacios/${id}`);
                if (res.data.success) {
                    window.Toast.fire({ icon: 'success', title: 'ESPACIO ELIMINADO' });
                    this.cerrarModales();
                    await this.cargarEspacios();
                }
            } catch (err) {
                Swal.fire('Error', err.response?.data?.error || 'No se puede eliminar un espacio ocupado', 'error');
            }
        }
    },

    cerrarModales() {
        document.querySelectorAll('.modal-neo').forEach(m => m.classList.add('hidden'));
    },

    setupEventListeners() {
        const formCfg = document.getElementById('formConfigEspacio');
        if (formCfg) formCfg.onsubmit = (e) => this.guardarEspacioConfig(e);

        const formIn = document.getElementById('formIngreso');
        if (formIn) formIn.onsubmit = (e) => this.registrarIngreso(e);

        const formOut = document.getElementById('formSalida');
        if (formOut) formOut.onsubmit = (e) => this.registrarSalida(e);
    }
};

module.exports = ParqueaderoModule;