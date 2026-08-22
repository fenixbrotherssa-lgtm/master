const api = require('./api');
const { marcarBuscando } = require('./uiLoading');

const RecepcionModule = {
    habitacionesCache: [],
    habSeleccionada: null,
    cajaId: null,
    acompanantesActuales: [], 
    
    // VARIABLES PARA EL POS (TIENDA)
    productosPOS: [],
    carritoPOS: [],

    // VARIABLE PARA EL ESTADO DE CUENTA
    folioActual: null,

    // ====== RESERVAS ======
    reservasCache: [],
    filtroReservaActivo: 'hoy',

    async init() {
        console.log("🚀 Modulo Recepción: Rack Inteligente, POS, Reservas & Check-Out...");
        this.renderSedeSelector();
        await this.verificarCaja();
        await this.cargarRack();
        await this.cargarProductosPOS();
        this.setupEventListeners();
        this.setupSocket();
        window.RecepcionModule = this;
    },

    setupSocket() {
        if (!window.socket) return;
        window.socket.on('habitacion:cambio', () => {
            this.cargarRack();
        });
        window.socket.on('producto:stock', () => {
            this.cargarProductosPOS();
        });
    },

    switchTab(tab) {
        const secciones = { rack: 'section-rack', reservas: 'section-reservas', pos: 'section-pos' };
        const botones   = { rack: 'tab-rack',     reservas: 'tab-reservas',     pos: 'tab-pos' };

        Object.keys(secciones).forEach(k => {
            const sec = document.getElementById(secciones[k]);
            const btn = document.getElementById(botones[k]);
            if (sec) sec.classList.toggle('hidden', k !== tab);
            if (btn) btn.classList.toggle('active', k === tab);
        });

        if (tab === 'rack') this.cargarRack();
        else if (tab === 'pos') this.cargarProductosPOS();
        else if (tab === 'reservas') this.cargarReservas();
    },

    renderSedeSelector() { App.renderSedeSelector('sedeSelectorRecepcion', () => {
        this.cargarRack();
        this.cargarProductosPOS();
        this.cargarReservas();
    }); },

    async verificarCaja() {
        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const sedeId = localStorage.getItem('currentSedeId') || user.SedeID;
            const res = await api.get(`/caja/estado/${user.UsuarioID}/${sedeId}`);
            this.cajaId = res.data.abierta ? res.data.caja.CajaID : null;
        } catch (err) {
            console.error("Error verificando caja:", err);
            this.cajaId = null; // Seguro: sin caja si el servidor falla
        }
    },

    // ==========================================
    // LÓGICA DEL RACK (CON ALERTA DE VENCIMIENTO)
    // ==========================================
    async cargarRack() {
        try {
            const sedeId = localStorage.getItem('currentSedeId') || JSON.parse(localStorage.getItem('user')).SedeID;
            const res = await api.get(`/recepcion/rack/${sedeId}`);
            this.habitacionesCache = res.data;
            this.renderRack();
            this.calcularEstadisticas();
        } catch (err) { window.Toast.fire({ icon: 'error', title: 'Error cargando Rack' }); }
    },

    renderRack() {
        const viewport = document.getElementById('rack-viewport');
        if (!viewport) return;

        const pisos = [...new Set(this.habitacionesCache.map(h => h.Piso))].sort((a,b) => a-b);
        const ahora = new Date();
        
        viewport.innerHTML = pisos.map(piso => `
            <div class="piso-header"><i class="fas fa-layer-group"></i> Planta ${piso}</div>
            <div class="grid-habitaciones">
                ${this.habitacionesCache.filter(h => h.Piso === piso).map(h => {
                    let statusClass = h.Estado.toLowerCase();
                    let infoHuesped = '';
                    let timer = '';

                    if (h.Estado === 'OCUPADA') {
                        infoHuesped = `<div class="huesped-name"><i class="fas fa-user"></i> ${h.Huesped}</div>`;
                        
                        const fechaLimpia = h.FechaSalidaProgramada ? h.FechaSalidaProgramada.replace('T', ' ').replace('Z', '') : '';
                        const salida = new Date(fechaLimpia);
                        const estaVencida = salida < ahora;
                        
                        if (estaVencida) {
                            statusClass = 'ocupada vencida'; 
                            timer = `<div class="timer-badge" style="background:var(--hotel-danger); animation: pulse 1.5s infinite;"><i class="fas fa-exclamation-triangle"></i> ¡VENCIDO!</div>`;
                        } else {
                            timer = `<div class="timer-badge"><i class="far fa-clock"></i> ${h.FechaSalidaFmt || '--:--'}</div>`;
                        }
                    }

                    return `
                        <div class="room-card-rack ${statusClass}" onclick="RecepcionModule.gestionarHabitacion(${h.HabitacionID})">
                            ${timer}
                            <div class="room-type">${h.Categoria}</div>
                            <div class="room-number">${h.NroHabitacion}</div>
                            <div style="font-size:0.6rem; font-weight:900; opacity:0.6;">${h.Estado}</div>
                            ${infoHuesped}
                        </div>
                    `;
                }).join('')}
            </div>
        `).join('');
    },

    calcularEstadisticas() {
        const total = this.habitacionesCache.length;
        const ocupadas = this.habitacionesCache.filter(h => h.Estado === 'OCUPADA').length;
        const pct = total > 0 ? Math.round((ocupadas / total) * 100) : 0;
        document.getElementById('pct-ocupacion').textContent = `${pct}%`;
    },

    gestionarHabitacion(id) {
        const hab = this.habitacionesCache.find(h => h.HabitacionID === id);
        this.habSeleccionada = hab;

        if (hab.Estado === 'DISPONIBLE') {
            // 🛡️ INTERCEPCIÓN INTELIGENTE: Validamos antes de dejarlo vender el cuarto
            this.validarRiesgoSobreventa(hab);
        } else if (hab.Estado === 'OCUPADA') {
            this.abrirFolioCheckout(hab);
        } else if (hab.Estado === 'LIMPIEZA') {
            // Igual que MANTENIMIENTO: no se puede asignar hasta cambiar el estado en Habitaciones
            Swal.fire({
                icon: 'info',
                title: 'HABITACIÓN EN LIMPIEZA',
                html: `La habitación <b>${hab.NroHabitacion}</b> está en LIMPIEZA.<br><br>Cámbiela a <b>DISPONIBLE</b> desde el módulo de <b>Habitaciones</b> antes de asignarla a un huésped.`,
                confirmButtonText: 'ENTENDIDO',
                confirmButtonColor: 'var(--hotel-blue)',
                background: 'var(--hotel-bg)'
            });
        }
    },

    async validarRiesgoSobreventa(hab) {
        // 1. Refrescamos silenciosamente las reservas para tener el dato exacto de este segundo
        await this.cargarReservas(); 

        // 2. ¿Cuántos cuartos físicos quedan libres de esta categoría exacta?
        const libres = this.habitacionesCache.filter(h =>
            (h.Estado === 'DISPONIBLE' || h.Estado === 'LIMPIEZA') &&
            h.Categoria === hab.Categoria
        ).length;

        // 3. ¿Cuántas reservas tenemos programadas para llegar HOY de esta categoría?
        const hoyStr = new Date().toISOString().slice(0, 10);
        const reservasPendientes = this.reservasCache.filter(r => 
            (r.Estado === 'PENDIENTE' || r.Estado === 'CONFIRMADA') &&
            (r.FechaLlegada || '').slice(0, 10) === hoyStr &&
            r.TipoNombre === hab.Categoria
        ).length;

        // 4. LA REGLA DE ORO: Si hay reservas y los cuartos libres no alcanzan para cubrirlas
        if (reservasPendientes > 0 && libres <= reservasPendientes) {
            Swal.fire({
                icon: 'warning',
                title: '¡ALERTA DE SOBREVENTA!',
                html: `<div style="text-align:left; font-size:0.95rem; color:#2c3e50;">
                        Solo te queda <b>${libres}</b> habitación tipo <b>${hab.Categoria}</b> y tienes <b>${reservasPendientes}</b> reserva(s) para hoy.<br><br>
                        Si le das este cuarto a un cliente de la calle, el cliente de la reserva se quedará sin habitación cuando llegue.<br><br>
                        <b>¿QUÉ DEBES HACER?</b><br>
                        Ve a la pestaña de Reservas y llama al cliente para confirmar. Si no viene, <b>cancela la reserva o márcala como "NO VINO"</b> para que el sistema libere este cuarto.
                       </div>`,
                showCancelButton: true,
                confirmButtonText: '<i class="fas fa-calendar-check"></i> IR A RESERVAS',
                cancelButtonText: 'FORZAR INGRESO (Riesgo propio)',
                confirmButtonColor: 'var(--hotel-blue)',
                cancelButtonColor: '#95a5a6',
                background: 'var(--hotel-bg)'
            }).then((result) => {
                if (result.isConfirmed) {
                    // Lo mandamos de un plumazo a la pestaña de Reservas para que llame al cliente
                    this.switchTab('reservas');
                } else if (result.dismiss === Swal.DismissReason.cancel) {
                    // Por si el administrador quiere forzar la venta asumiendo el riesgo
                    this.abrirCheckIn(hab);
                }
            });
        } else {
            // Si hay cuartos de sobra (ej. 3 libres y 1 sola reserva), abre normal y sin molestar
            this.abrirCheckIn(hab);
        }
    },

    // ==========================================
    // 🚗 CARGAR ESPACIOS DE PARQUEO LIBRES
    // ==========================================
    async cargarEspaciosParqueoLibres() {
        try {
            const sedeId = localStorage.getItem('currentSedeId') || JSON.parse(localStorage.getItem('user')).SedeID;
            const res = await api.get(`/parqueadero/espacios/${sedeId}`);
            
            // Solo nos interesan los que están libres
            const libres = res.data.filter(e => e.Estado === 'LIBRE');
            
            const selectParqueo = document.getElementById('in-espacio-parqueo');
            if (selectParqueo) {
                selectParqueo.innerHTML = '<option value="">-- NO ASIGNAR (O SIN VEHÍCULO) --</option>' + 
                    libres.map(e => `<option value="${e.EspacioID}">🚗 ESPACIO: ${e.CodigoEspacio} (${e.Zona || 'PRINCIPAL'})</option>`).join('');
            }
        } catch (error) {
            console.warn("No se pudo cargar el parqueadero", error);
        }
    },

    // ==========================================
    // CHECK-IN LÓGICA
    // ==========================================
    abrirCheckIn(hab) {
        const modal = document.getElementById('modalCheckIn');
        const form = document.getElementById('formCheckIn');
        form.reset();
        
        this.acompanantesActuales = []; 
        this.renderAcompanantes();
        
        document.getElementById('modalCheckInTitulo').textContent = `CHECK-IN: HABITACIÓN ${hab.NroHabitacion}`;
        document.getElementById('in-habitacionId').value = hab.HabitacionID;

        // Por defecto un check-in NO viene de reserva. Si llega de una, se setea después.
        const inResv = document.getElementById('in-reservaId');
        if (inResv) inResv.value = '';
        
        const inDescuento = document.getElementById('in-descuento');
        if(inDescuento) inDescuento.value = 0;

        const inMigracion = document.getElementById('in-es-migracion');
        if(inMigracion) {
            inMigracion.checked = false;
            this.toggleMigracion();
        }
        
        document.getElementById('lbl-edad').textContent = 'EDAD: --'; 
        this.gestionarCamposVoucher(); 
        this.recalcularPrecios(); 
        this.cargarEspaciosParqueoLibres(); // 🚗 SE CARGAN LOS PARQUEADEROS AL ABRIR
        
        modal.classList.remove('hidden');
    },

    toggleMigracion() {
        const inMigracion = document.getElementById('in-es-migracion');
        const boxFecha = document.getElementById('box-fecha-migracion');
        const seccionPago = document.getElementById('seccion-pago-checkin');
        
        if (inMigracion.checked) {
            seccionPago.style.display = 'none';
            boxFecha.style.display = 'block';
            document.getElementById('in-montoAbono').value = 0;
        } else {
            seccionPago.style.display = 'block';
            boxFecha.style.display = 'none';
            this.recalcularPrecios();
        }
    },

    recalcularPrecios() {
        if (!this.habSeleccionada) return;
        const tipo = document.getElementById('in-tipoAlquiler').value;
        const tiempo = parseInt(document.getElementById('in-tiempo').value) || 1; 
        const descuento = parseFloat(document.getElementById('in-descuento').value) || 0;
        
        const esMigracion = document.getElementById('in-es-migracion').checked;
        const fechaInput = document.getElementById('in-fecha-ingreso-migracion').value;
        
        let baseDate = (esMigracion && fechaInput) ? new Date(fechaInput + 'T12:00:00') : new Date();
        
        const lblTiempo = document.getElementById('lbl-tiempo-dinamico');
        const boxRango = document.getElementById('box-rango-fechas');
        
        let precioUnitario = 0;
        let txtSalida = "";

        if (tipo === 'Momento') {
            precioUnitario = this.habSeleccionada.PrecioMomento;
            lblTiempo.textContent = "CANTIDAD (MOMENTOS)"; 
            const horasBase = this.habSeleccionada.HorasMomento || 3;
            baseDate.setHours(baseDate.getHours() + (tiempo * horasBase));
            txtSalida = `${baseDate.toLocaleDateString()} a las ${baseDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
        } 
        else if (tipo === 'Dia') {
            precioUnitario = this.habSeleccionada.PrecioDia;
            lblTiempo.textContent = "CANTIDAD (DÍAS)";
            const horaSalida = '12:00';
            
            // LÓGICA DE DÍAS CORREGIDA
            // Si la hora actual es antes de las 8 AM (< 8), restamos 1 día al cálculo para que salga hoy (si tiempo es 1).
            const diasASumar = baseDate.getHours() < 8 ? (tiempo - 1) : tiempo;
            baseDate.setDate(baseDate.getDate() + diasASumar);
            
            txtSalida = `${baseDate.toLocaleDateString()} a las ${horaSalida}`;
        } 
        else if (tipo === 'Periodo') {
            precioUnitario = this.habSeleccionada.PrecioPeriodo;
            lblTiempo.textContent = "CANTIDAD (MES/QUINCENA)";
            const horaSalida = '12:00';
            baseDate.setDate(baseDate.getDate() + (tiempo * 30)); 
            txtSalida = `${baseDate.toLocaleDateString()} a las ${horaSalida}`;
        }

        let totalFinal = Math.max(0, (precioUnitario * tiempo) - descuento);
        document.getElementById('ui-total-hospedaje').textContent = `$${totalFinal.toFixed(2)}`;
        document.getElementById('in-montoAbono').value = totalFinal.toFixed(2);
        
        if(boxRango) {
            boxRango.innerHTML = `<i class="fas fa-sign-out-alt"></i> Salida Estimada: <strong>${txtSalida}</strong>`;
        }
    },

    calcularEdad() {
        const fechaNac = document.getElementById('in-nacimiento').value;
        const labelEdad = document.getElementById('lbl-edad');
        if (!fechaNac) return labelEdad.textContent = 'EDAD: --';

        const hoy = new Date();
        const cumpleanos = new Date(fechaNac);
        let edad = hoy.getFullYear() - cumpleanos.getFullYear();
        const m = hoy.getMonth() - cumpleanos.getMonth();
        if (m < 0 || (m === 0 && hoy.getDate() < cumpleanos.getDate())) edad--;
        
        labelEdad.textContent = `EDAD: ${edad} AÑOS`;
        labelEdad.style.color = edad < 18 ? 'var(--hotel-danger)' : 'var(--hotel-success)';
    },

    async buscarCliente() {
        const inputDoc = document.getElementById('in-documento');
        const doc = inputDoc.value;
        if (!doc) return;
        marcarBuscando(inputDoc, true);
        try {
            const res = await api.get(`/recepcion/cliente/${doc}`);

            if (res.data.success) {
                const c = res.data.cliente;
                
                // Llenamos los inputs con los datos recuperados (BD Local o Padrón CSV)
                document.getElementById('in-nombre').value = c.NombreFull || '';
                document.getElementById('in-telefono').value = c.Telefono || '';
                document.getElementById('in-procedencia').value = c.Procedencia || '';
                document.getElementById('in-correo').value = c.Correo || '';
                
                if (c.FechaNacimiento) {
                    document.getElementById('in-nacimiento').value = c.FechaNacimiento.split('T')[0];
                    this.calcularEdad();
                } else {
                    document.getElementById('in-nacimiento').value = '';
                    document.getElementById('lbl-edad').textContent = 'EDAD: --';
                }
                
                // Validamos el origen de los datos para darle feedback visual al usuario
                if (res.data.source === 'padron') {
                    window.Toast.fire({ icon: 'success', title: 'DATOS OBTENIDOS DEL SRI', text: 'Se auto-rellenaron datos del Padrón Nacional.' });
                } else {
                    window.Toast.fire({ icon: 'success', title: 'Cliente encontrado en Base Local' });

                    // 🔥 ALERTA DE MOROSIDAD
                    if (res.data.deudaPendiente) {
                        Swal.fire({
                            icon: 'warning',
                            title: '¡ALERTA: CLIENTE MOROSO!',
                            html: `Este cliente tiene un saldo pendiente de <b style="color:var(--hotel-danger); font-size:1.2rem;">$${res.data.montoDeuda.toFixed(2)}</b> en estadías anteriores.<br><br>Consulte el módulo de reportes para gestionar el cobro.`,
                            confirmButtonText: 'ENTENDIDO',
                            confirmButtonColor: 'var(--hotel-danger)',
                            background: 'var(--hotel-bg)'
                        });
                    }
                }
            } else {
                // Si la BD y el CSV dan negativo, es totalmente nuevo
                document.getElementById('in-nombre').value = '';
                document.getElementById('in-telefono').value = '';
                document.getElementById('in-procedencia').value = '';
                document.getElementById('in-correo').value = '';
                document.getElementById('in-nacimiento').value = '';
                document.getElementById('lbl-edad').textContent = 'EDAD: --';
                
                window.Toast.fire({ icon: 'info', title: 'NUEVO CLIENTE', text: 'No existe en registros. Por favor, complete los datos manualmente.' });
            }
        } catch (e) {
            console.error("Error buscando cliente:", e);
            window.Toast.fire({ icon: 'error', title: 'Error en conexión de búsqueda' });
        } finally {
            marcarBuscando(inputDoc, false);
        }
    },

    agregarAcompanante() {
        const doc = document.getElementById('in-acomp-doc').value.trim();
        const nom = document.getElementById('in-acomp-nom').value.trim();
        if (!nom) return window.Toast.fire({ icon: 'warning', title: 'El nombre es obligatorio' });
        this.acompanantesActuales.push({ documento: doc, nombre: nom });
        document.getElementById('in-acomp-doc').value = '';
        document.getElementById('in-acomp-nom').value = '';
        this.renderAcompanantes();
    },

    eliminarAcompanante(index) {
        this.acompanantesActuales.splice(index, 1);
        this.renderAcompanantes();
    },

    renderAcompanantes() {
        const list = document.getElementById('lista-acompanantes');
        if (!list) return;
        list.innerHTML = this.acompanantesActuales.map((a, i) => `
            <div style="display:flex; justify-content:space-between; align-items:center; background:#f1f3f5; padding:5px 10px; border-radius:8px; margin-bottom:5px;">
                <div style="font-size:0.75rem;"><strong>${a.nombre}</strong> <small>(${a.documento || 'Sin Doc'})</small></div>
                <button type="button" onclick="RecepcionModule.eliminarAcompanante(${i})" style="color:var(--hotel-danger); background:none; border:none; cursor:pointer;"><i class="fas fa-times"></i></button>
            </div>
        `).join('');
        document.getElementById('in-adultos').value = 1 + this.acompanantesActuales.length;
    },

    gestionarCamposVoucher() {
        const metodoSelect = document.getElementById('in-metodoPago');
        const fileContainer = document.getElementById('container-voucher-rec');
        if(!metodoSelect || !fileContainer) return;
        if(metodoSelect.value === '2' || metodoSelect.value === '3') {
            fileContainer.style.display = 'block';
        } else {
            fileContainer.style.display = 'none';
            document.getElementById('voucherFileRec').value = ''; 
        }
    },

    // ==========================================
    // LÓGICA DEL POS (TIENDA Y CARRITO)
    // ==========================================
    async cargarProductosPOS() {
        try {
            const sedeId = localStorage.getItem('currentSedeId') || JSON.parse(localStorage.getItem('user')).SedeID;
            const res = await api.get(`/inventario/sede/${sedeId}`);
            this.productosPOS = res.data;
            this.renderProductosPOS();
        } catch (e) { console.error("Error cargando POS", e); }
    },

    renderProductosPOS(filtro = '') {
        const grid = document.getElementById('grid-productos-pos');
        if(!grid) return;

        const filtrados = this.productosPOS.filter(p => 
            p.Nombre.toLowerCase().includes(filtro.toLowerCase()) || 
            (p.CodigoBarras && p.CodigoBarras.includes(filtro))
        );

        grid.innerHTML = filtrados.map(p => `
            <div class="room-card-rack" style="padding: 15px; text-align: center; border-left: none;" onclick="RecepcionModule.agregarAlCarrito(${p.ProductoID})">
                <div style="font-size:2rem; color:var(--hotel-gold); margin-bottom:10px;"><i class="fas fa-box-open"></i></div>
                <div style="font-weight:900; color:var(--hotel-blue); font-size:0.85rem; height:35px; overflow:hidden;">${p.Nombre}</div>
                <div style="color:var(--hotel-success); font-weight:900; font-size:1.2rem; margin:10px 0;">$${parseFloat(p.PrecioVenta).toFixed(2)}</div>
                <div style="font-size:0.65rem; color:#718096; font-weight:bold;">STOCK: ${p.StockActual}</div>
            </div>
        `).join('');
    },

    buscarProductoPOS() {
        const query = document.getElementById('in-buscador-pos').value;
        this.renderProductosPOS(query);
    },

    procesarCodigoBarras(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const codigo = document.getElementById('in-buscador-pos').value.trim();
            if (!codigo) return;

            const prod = this.productosPOS.find(p => p.CodigoBarras === codigo);
            if (prod) {
                this.agregarAlCarrito(prod.ProductoID);
                document.getElementById('in-buscador-pos').value = '';
                this.renderProductosPOS(); 
            } else {
                window.Toast.fire({ icon: 'error', title: 'Producto no encontrado' });
            }
        }
    },

    agregarAlCarrito(productoId) {
        const prod = this.productosPOS.find(p => p.ProductoID === productoId);
        if (!prod) return;

        if (prod.StockActual < 1) {
            return window.Toast.fire({ icon: 'warning', title: 'Producto Agotado' });
        }

        const existente = this.carritoPOS.find(item => item.ProductoID === productoId);
        
        if (existente) {
            if (existente.Cantidad + 1 > prod.StockActual) {
                return window.Toast.fire({ icon: 'warning', title: 'Stock Insuficiente' });
            }
            existente.Cantidad++;
        } else {
            this.carritoPOS.push({
                ProductoID: prod.ProductoID,
                Nombre: prod.Nombre,
                PrecioVenta: prod.PrecioVenta,
                Cantidad: 1,
                EsCortesia: false
            });
        }
        
        window.Toast.fire({ icon: 'success', title: 'Agregado al carrito' });
        this.renderCarrito();
    },

    modificarCantidadCarrito(index, delta) {
        const item = this.carritoPOS[index];
        const prodDB = this.productosPOS.find(p => p.ProductoID === item.ProductoID);

        const nuevaCant = item.Cantidad + delta;
        
        if (nuevaCant <= 0) {
            this.eliminarDelCarrito(index);
            return;
        }

        if (nuevaCant > prodDB.StockActual) {
            return window.Toast.fire({ icon: 'warning', title: 'Límite de stock alcanzado' });
        }

        item.Cantidad = nuevaCant;
        this.renderCarrito();
    },

    eliminarDelCarrito(index) {
        this.carritoPOS.splice(index, 1);
        this.renderCarrito();
    },

    renderCarrito() {
        const list = document.getElementById('pos-carrito-lista');
        const lblTotal = document.getElementById('pos-total-carrito');
        if(!list || !lblTotal) return;

        let total = 0;

        list.innerHTML = this.carritoPOS.map((item, index) => {
            const subtotal = item.EsCortesia ? 0 : (item.PrecioVenta * item.Cantidad);
            total += subtotal;

            return `
                <div style="background:var(--hotel-bg); padding:10px 15px; border-radius:15px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; box-shadow:inset 2px 2px 5px var(--hotel-shadow-dark);">
                    <div style="flex:2;">
                        <div style="font-weight:800; color:var(--hotel-blue); font-size:0.8rem;">${item.Nombre}</div>
                        <div style="color:var(--hotel-success); font-weight:900;">$${parseFloat(item.PrecioVenta).toFixed(2)} c/u</div>
                    </div>
                    
                    <div style="display:flex; align-items:center; gap:10px;">
                        <button type="button" class="btn-neo" style="padding:5px 10px;" onclick="RecepcionModule.modificarCantidadCarrito(${index}, -1)"><i class="fas fa-minus"></i></button>
                        <strong style="font-size:1.1rem; color:var(--hotel-blue);">${item.Cantidad}</strong>
                        <button type="button" class="btn-neo" style="padding:5px 10px;" onclick="RecepcionModule.modificarCantidadCarrito(${index}, 1)"><i class="fas fa-plus"></i></button>
                    </div>

                    <div style="flex:1; text-align:right; font-weight:900; font-size:1.1rem; color:var(--hotel-blue);">
                        $${subtotal.toFixed(2)}
                    </div>
                    
                    <button type="button" class="btn-neo" style="padding:8px 12px; margin-left:10px; color:var(--hotel-danger);" onclick="RecepcionModule.eliminarDelCarrito(${index})"><i class="fas fa-trash"></i></button>
                </div>
            `;
        }).join('');

        lblTotal.textContent = `$${total.toFixed(2)}`;
    },

    abrirModalCobroPOS() {
        if (this.carritoPOS.length === 0) return window.Toast.fire({ icon: 'warning', title: 'Carrito Vacío' });

        const habsOcupadas = this.habitacionesCache.filter(h => h.Estado === 'OCUPADA');
        const selectHab = document.getElementById('pos-habitacion-select');
        
        if (selectHab) {
            selectHab.innerHTML = '<option value="">-- VENTA EXTERNA (LOBBY) --</option>' + 
                habsOcupadas.map(h => `<option value="${h.RecepcionID}">HAB. ${h.NroHabitacion} - ${h.Huesped}</option>`).join('');
        }

        const total = this.carritoPOS.reduce((acc, item) => acc + (item.EsCortesia ? 0 : item.PrecioVenta * item.Cantidad), 0);
        document.getElementById('pos-monto-cobrar').textContent = `$${total.toFixed(2)}`;
        document.getElementById('pos-monto-recibido').value = total.toFixed(2);
        
        this.gestionarTipoVentaPOS(); 
        document.getElementById('modalPagoPOS').classList.remove('hidden');
    },

    gestionarTipoVentaPOS() {
        const recepcionId = document.getElementById('pos-habitacion-select').value;
        const panelPago = document.getElementById('pos-panel-pago-inmediato');
        
        if (recepcionId) {
            panelPago.style.display = 'none';
        } else {
            panelPago.style.display = 'block';
        }
    },

    cerrarModalCobroPOS() {
        document.getElementById('modalPagoPOS').classList.add('hidden');
    },

    async procesarVentaPOS(e) {
        e.preventDefault();
        if (this.carritoPOS.length === 0) return;

        const recepcionId = document.getElementById('pos-habitacion-select').value;
        const metodoPago = document.getElementById('pos-metodo-pago').value;
        const monto = parseFloat(document.getElementById('pos-monto-recibido').value) || 0;
        
        const user = JSON.parse(localStorage.getItem('user'));
        const sedeId = localStorage.getItem('currentSedeId') || user.SedeID;

        let pagoInmediato = null;

        if (!recepcionId) {
            if (!this.cajaId) return Swal.fire({ icon: 'error', title: 'CAJA CERRADA', text: 'Debe aperturar caja para ventas directas al público.' });
            const refPOS = document.getElementById('pos-referencia') ? document.getElementById('pos-referencia').value : '';
            pagoInmediato = { Monto: monto, MetodoID: metodoPago, Referencia: refPOS };
        }

        // ¿Voucher cargado? (solo aplica a venta externa con transferencia/tarjeta)
        const voucherInput = document.getElementById('pos-voucher');
        const voucherFile = (voucherInput && voucherInput.files) ? voucherInput.files[0] : null;

        try {
            let res;
            if (voucherFile && pagoInmediato) {
                // Multipart: reutiliza el mismo multer de recepción en /inventario/venta
                const fd = new FormData();
                fd.append('SedeID', sedeId);
                fd.append('UsuarioID', user.UsuarioID);
                fd.append('CajaID', this.cajaId);
                fd.append('RecepcionID', recepcionId || '');
                fd.append('carrito', JSON.stringify(this.carritoPOS));
                fd.append('pagoInmediato', JSON.stringify(pagoInmediato));
                fd.append('voucher', voucherFile);
                res = await api.post('/inventario/venta', fd);
            } else {
                const payload = {
                    SedeID: sedeId,
                    UsuarioID: user.UsuarioID,
                    CajaID: this.cajaId,
                    RecepcionID: recepcionId || null,
                    carrito: this.carritoPOS,
                    pagoInmediato: pagoInmediato
                };
                res = await api.post('/inventario/venta', payload);
            }

            if (res.data.success) {
                await Swal.fire({ icon: 'success', title: 'VENTA PROCESADA', text: 'Stock y saldos actualizados correctamente.' });
                this.carritoPOS = [];
                this.renderCarrito();
                if (voucherInput) voucherInput.value = '';
                const boxV = document.getElementById('pos-box-voucher');
                if (boxV) boxV.style.display = 'none';
                this.cerrarModalCobroPOS();
                this.cargarProductosPOS(); 
            }
        } catch (err) {
            const msg = err.response?.data?.error || "Error al procesar la venta";
            Swal.fire({ icon: 'error', title: 'FALLO EN VENTA', text: msg });
        }
    },

    // ==========================================
    // LÓGICA DE FOLIO, CHECK-OUT Y ABONOS
    // ==========================================
    async abrirFolioCheckout(hab) {
        try {
            const res = await api.get(`/recepcion/folio/${hab.RecepcionID}`);
            this.folioActual = res.data;
            this.renderFolio(hab);

            this.gestionarCamposVoucherOut();

            const checkFactura = document.getElementById('out-generar-factura');
            if (checkFactura) checkFactura.checked = false;
            this.toggleOpcionesFactura();

            document.getElementById('modalCheckout').classList.remove('hidden');

            this.cargarCodigoAccesoEnCheckout(hab.HabitacionID);
        } catch (err) {
            console.error(err);
            window.Toast.fire({ icon: 'error', title: 'Error obteniendo el Folio de la habitación' });
        }
    },

    // Cerradura inteligente — consulta y muestra el código de acceso vigente
    // de una habitación. No falla el flujo si no hay cerradura instalada aún.
    async consultarCodigoAcceso(habitacionId) {
        try {
            const res = await api.get(`/cerraduras/habitacion/${habitacionId}/codigo`);
            return res.data;
        } catch (_) {
            return { success: false, tieneCerradura: false, codigo: null };
        }
    },

    // Tras el check-in: la asignación del código es fire-and-forget en el backend,
    // así que reintentamos un par de veces antes de mostrarlo (o desistir en silencio
    // si la habitación no tiene cerradura vinculada).
    async mostrarCodigoAcceso(habitacionId) {
        for (let intento = 0; intento < 4; intento++) {
            const data = await this.consultarCodigoAcceso(habitacionId);
            if (!data.tieneCerradura) return; // sin cerradura instalada, no hay nada que mostrar
            if (data.codigo) {
                await Swal.fire({
                    title: 'CÓDIGO DE ACCESO GENERADO',
                    html: `<div style="font-size:2.2rem; font-weight:900; letter-spacing:6px; color:var(--hotel-blue);">${data.codigo}</div>`,
                    icon: 'success',
                    confirmButtonText: 'Entendido'
                });
                return;
            }
            await new Promise(r => setTimeout(r, 1200));
        }
    },

    // En el modal de checkout: muestra el código vigente por si hay que repetírselo
    // al huésped durante la estadía (sin bloquear ni reintentar, solo informativo).
    async cargarCodigoAccesoEnCheckout(habitacionId) {
        const wrap = document.getElementById('out-codigo-acceso-wrap');
        if (!wrap) return;
        wrap.style.display = 'none';
        const data = await this.consultarCodigoAcceso(habitacionId);
        if (data.tieneCerradura && data.codigo) {
            document.getElementById('out-codigo-acceso').textContent = data.codigo;
            wrap.style.display = '';
        }
    },

    renderFolio(hab) {
        document.getElementById('modalCheckoutTitulo').textContent = `ESTADO DE CUENTA: HABITACIÓN ${hab.NroHabitacion}`;
        document.getElementById('out-huesped').textContent = this.folioActual.recepcion.NombreFull;
        
        let totalCargos = parseFloat(this.folioActual.recepcion.TotalHospedaje);
        let totalAbonos = 0;
        let abonosCheckIn = 0;
        
        let htmlConsumos = `<tr><td>Alojamiento (${this.folioActual.recepcion.TipoAlquiler})</td><td class="text-right">$${totalCargos.toFixed(2)}</td></tr>`;
        
        this.folioActual.consumos.forEach(c => {
            htmlConsumos += `<tr><td>${c.Cantidad}x ${c.Producto}</td><td class="text-right">$${c.Subtotal.toFixed(2)}</td></tr>`;
            totalCargos += parseFloat(c.Subtotal);
        });

        let htmlAbonos = '';
        this.folioActual.abonos.forEach(a => {
            htmlAbonos += `<tr><td>${a.Observacion}</td><td class="text-right text-success">+$${a.Monto.toFixed(2)}</td></tr>`;
            totalAbonos += parseFloat(a.Monto);
            if (a.Observacion.includes('CHECK-IN')) abonosCheckIn += parseFloat(a.Monto);
        });

        // ✅ LOGICA MATEMÁTICA DE MIGRACIÓN: Si el Hospedaje está pagado, pero en sistema los pagos de CHECK-IN no lo cubren
        const costoHospedaje = parseFloat(this.folioActual.recepcion.TotalHospedaje);
        if (this.folioActual.recepcion.EstadoPago === 'Pagado' && abonosCheckIn < costoHospedaje) {
            const abonoMigracion = costoHospedaje - abonosCheckIn;
            htmlAbonos = `<tr><td><i class="fas fa-history"></i> Saldo a favor (Migración/Pago Previo)</td><td class="text-right text-success">+$${abonoMigracion.toFixed(2)}</td></tr>` + htmlAbonos;
            totalAbonos += abonoMigracion;
        }

        if (totalAbonos === 0) {
            htmlAbonos = `<tr><td colspan="2" class="text-center" style="opacity:0.5;">No hay pagos registrados</td></tr>`;
        }

        const tbCargos = document.getElementById('tb-folio-cargos');
        const tbAbonos = document.getElementById('tb-folio-abonos');
        if (tbCargos) tbCargos.innerHTML = htmlConsumos;
        if (tbAbonos) tbAbonos.innerHTML = htmlAbonos;

        document.getElementById('out-total-cargos').textContent = `$${totalCargos.toFixed(2)}`;
        document.getElementById('out-total-abonos').textContent = `$${totalAbonos.toFixed(2)}`;
        
        const uiSaldo = document.getElementById('out-saldo-pendiente');
        const inMonto = document.getElementById('out-montoAbono');
        const sectionPago = document.getElementById('section-pago-checkout');
        const btnAbonar = document.getElementById('btn-abonar-cuenta');

        const saldoPendiente = totalCargos - totalAbonos;

        if (saldoPendiente > 0) {
            uiSaldo.textContent = `$${saldoPendiente.toFixed(2)}`;
            uiSaldo.style.color = 'var(--hotel-danger)';
            inMonto.value = saldoPendiente.toFixed(2);
            sectionPago.style.display = 'block'; 
            if(btnAbonar) btnAbonar.style.display = 'flex';
        } else {
            uiSaldo.textContent = "$0.00";
            uiSaldo.style.color = 'var(--hotel-success)';
            inMonto.value = "0.00";
            sectionPago.style.display = 'none'; 
            if(btnAbonar) btnAbonar.style.display = 'none';
        }
    },

    // ── NUEVA FUNCIÓN PARA ABONOS / PAGOS PARCIALES ──
    async registrarAbonoParcial() {
        if (!this.folioActual) return;
        if (!this.cajaId) return Swal.fire({icon: 'error', title: 'CAJA CERRADA', text: 'Debe aperturar caja para recibir abonos parciales.'});
        
        const saldoPendiente = parseFloat(document.getElementById('out-saldo-pendiente').textContent.replace('$', ''));
        if (saldoPendiente <= 0) return window.Toast.fire({icon: 'info', title: 'La cuenta no tiene saldo pendiente'});

        const { value: formValues } = await Swal.fire({
            title: 'REGISTRAR ABONO',
            html: `
                <label style="font-size:0.8rem; font-weight:bold; color:var(--hotel-blue); display:block; text-align:left; margin-bottom:5px;">Monto a Abonar (Máx $${saldoPendiente.toFixed(2)})</label>
                <input id="swal-monto" type="number" step="0.01" class="swal2-input" value="${saldoPendiente.toFixed(2)}" style="margin-bottom:15px; color:var(--hotel-success); font-weight:bold;">
                
                <label style="font-size:0.8rem; font-weight:bold; color:var(--hotel-blue); display:block; text-align:left; margin-bottom:5px;">Método de Pago</label>
                <select id="swal-metodo" class="swal2-input" style="margin-bottom:15px;" onchange="document.getElementById('box-voucher-abono').style.display = (this.value == '2' || this.value == '3') ? 'block' : 'none'">
                    <option value="1">EFECTIVO</option>
                    <option value="2">TRANSFERENCIA</option>
                    <option value="3">TARJETA</option>
                </select>
                
                <label style="font-size:0.8rem; font-weight:bold; color:var(--hotel-blue); display:block; text-align:left; margin-bottom:5px;">Referencia (Opcional)</label>
                <input id="swal-ref" type="text" class="swal2-input" placeholder="Lote / Nro. Comprobante" style="margin-bottom:15px;">

                <div id="box-voucher-abono" style="display:none; text-align:left;">
                    <label style="font-size:0.8rem; font-weight:bold; color:var(--hotel-blue); display:block; margin-bottom:5px;">Foto del Comprobante</label>
                    <input id="swal-voucher" type="file" class="swal2-file" accept="image/*,application/pdf">
                </div>
            `,
            didOpen: () => {
                // Al abrir la alerta, dispara el onchange para asegurar que se muestre/oculte bien
                document.getElementById('swal-metodo').dispatchEvent(new Event('change'));
            },
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: '<i class="fas fa-hand-holding-usd"></i> PROCESAR ABONO',
            cancelButtonText: 'CANCELAR',
            confirmButtonColor: 'var(--hotel-success)',
            background: 'var(--hotel-bg)',
            preConfirm: () => {
                const monto = parseFloat(document.getElementById('swal-monto').value);
                const metodo = document.getElementById('swal-metodo').value;
                const ref = document.getElementById('swal-ref').value;
                const voucherFile = document.getElementById('swal-voucher').files[0];
                
                if (!monto || monto <= 0) { Swal.showValidationMessage('Ingrese un monto válido'); return false; }
                if (monto > saldoPendiente) { Swal.showValidationMessage('El abono no puede superar la deuda'); return false; }
                
                return { monto, metodoId: metodo, referencia: ref, voucherFile };
            }
        });

        if (formValues) {
            try {
                // USAR FORMDATA PARA ENVIAR EL ARCHIVO AL BACKEND
                const formData = new FormData();
                formData.append('recepcionId', this.folioActual.recepcion.RecepcionID);
                formData.append('cajaId', this.cajaId);
                formData.append('monto', formValues.monto);
                formData.append('metodoId', formValues.metodoId);
                formData.append('referencia', formValues.referencia);
                
                // Si subió archivo, lo adjuntamos
                if (formValues.voucherFile) {
                    formData.append('voucher', formValues.voucherFile);
                }

                // Enviamos usando multipart/form-data
                const res = await api.post('/recepcion/abono', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
                
                if (res.data.success) {
                    window.Toast.fire({ icon: 'success', title: 'ABONO REGISTRADO' });
                    // Recargar el estado de cuenta y mantener la ventana abierta
                    await this.abrirFolioCheckout(this.habSeleccionada);
                }
            } catch (err) {
                Swal.fire({icon: 'error', title: 'ERROR', text: err.response?.data?.error || 'Fallo al procesar abono'});
            }
        }
    },

    gestionarCamposVoucherOut() {
        const metodoSelect = document.getElementById('out-metodoPago');
        const fileContainer = document.getElementById('container-voucher-out');
        if(!metodoSelect || !fileContainer) return;
        
        if(metodoSelect.value === '2' || metodoSelect.value === '3') {
            fileContainer.style.display = 'block';
        } else {
            fileContainer.style.display = 'none';
            document.getElementById('voucherFileOut').value = ''; 
        }
    },

    cerrarModalCheckout() {
        document.getElementById('modalCheckout').classList.add('hidden');
        this.folioActual = null;
    },

    toggleOpcionesFactura() {
        const checkbox = document.getElementById('out-generar-factura');
        const panel = document.getElementById('panel-opciones-factura');
        if (checkbox && panel) {
            panel.style.display = checkbox.checked ? 'block' : 'none';
        }
    },

    // ==========================================
    // ====== LÓGICA DE RESERVAS (NUEVO) ======
    // ==========================================
    async cargarReservas() {
        try {
            const sedeId = localStorage.getItem('currentSedeId') || JSON.parse(localStorage.getItem('user')).SedeID;
            const res = await api.get(`/reservas/lista/${sedeId}`);
            this.reservasCache = (res.data && res.data.reservas) ? res.data.reservas : [];
            this.renderReservas();
        } catch (err) {
            console.error("Error cargando reservas", err);
            window.Toast.fire({ icon: 'error', title: 'Error cargando reservas' });
        }
    },

    filtrarReservas(filtro) {
        this.filtroReservaActivo = filtro;
        ['hoy', 'proximas', 'atrasadas', 'todas'].forEach(k => {
            const b = document.getElementById('rfiltro-' + k);
            if (b) b.classList.toggle('active', k === filtro);
        });
        this.renderReservas();
    },

    renderReservas() {
        const cont = document.getElementById('reservas-lista');
        if (!cont) return;

        const hoyStr = new Date().toISOString().slice(0, 10);
        const activos = this.reservasCache.filter(r => r.Estado === 'PENDIENTE' || r.Estado === 'CONFIRMADA');
        let lista;

        if (this.filtroReservaActivo === 'hoy') {
            lista = activos.filter(r => (r.FechaLlegada || '').slice(0, 10) === hoyStr);
        } else if (this.filtroReservaActivo === 'proximas') {
            lista = activos.filter(r => (r.FechaLlegada || '').slice(0, 10) >= hoyStr);
        } else if (this.filtroReservaActivo === 'atrasadas') {
            lista = activos.filter(r => r.EsAtrasada === 1);
        } else {
            lista = this.reservasCache.slice(); // todas
        }

        if (lista.length === 0) {
            cont.innerHTML = `
                <div class="reservas-empty">
                    <i class="fas fa-calendar-times"></i>
                    No hay reservas en esta vista.
                </div>`;
            return;
        }

        cont.innerHTML = lista.map(r => this.renderReservaCard(r)).join('');
    },

    renderReservaCard(r) {
        const atrasada = (r.EsAtrasada === 1) ? 'atrasada' : '';
        const tel = r.Telefono || '';
        const contacto = [tel ? `<i class="fas fa-phone"></i> ${tel}` : '', r.Correo ? `<i class="fas fa-envelope"></i> ${r.Correo}` : '']
            .filter(Boolean).join(' &nbsp;·&nbsp; ');

        const meta = `📅 ${r.LlegadaFmt || ''} → ${r.SalidaFmt || ''} &nbsp;·&nbsp; 🛏️ ${r.TipoNombre || 'Tipo'} &nbsp;·&nbsp; 👤 ${r.NroAdultos || 1} ad. ${r.NroNinos ? '+' + r.NroNinos + ' niños' : ''}`;

        let acciones = '';
        if (r.Estado === 'PENDIENTE' || r.Estado === 'CONFIRMADA') {
            if (r.Estado === 'PENDIENTE') {
                acciones += `<button class="btn-mini green" onclick="RecepcionModule.confirmarReserva(${r.ReservaID})"><i class="fas fa-check"></i> CONFIRMAR</button>`;
            }
            if (tel) {
                acciones += `<button class="btn-mini gold" onclick="RecepcionModule.llamarReserva('${tel}', '${(r.NombreReserva || '').replace(/'/g, '')}')"><i class="fas fa-phone"></i> LLAMAR</button>`;
            }
            acciones += `<button class="btn-mini solid-blue" onclick="RecepcionModule.checkInDesdeReserva(${r.ReservaID})"><i class="fas fa-door-open"></i> CHECK-IN</button>`;
            acciones += `<button class="btn-mini red" onclick="RecepcionModule.marcarNoShow(${r.ReservaID})"><i class="fas fa-user-slash"></i> NO VINO</button>`;
            acciones += `<button class="btn-mini red" onclick="RecepcionModule.cancelarReserva(${r.ReservaID})"><i class="fas fa-times"></i> CANCELAR</button>`;
        }

        return `
            <div class="reserva-card estado-${r.Estado} ${atrasada}">
                <div class="reserva-cod"><i class="fas fa-hashtag"></i> ${r.CodigoReserva || '--'}</div>
                <div>
                    <div class="reserva-nombre">${r.NombreReserva || 'Sin nombre'}</div>
                    <div class="reserva-meta">${meta}</div>
                    ${contacto ? `<div class="reserva-contacto">${contacto}</div>` : ''}
                    ${r.Notas ? `<div class="reserva-contacto"><i class="fas fa-sticky-note"></i> ${r.Notas}</div>` : ''}
                </div>
                <div class="reserva-badge badge-${r.Estado}">${r.Estado}</div>
                ${acciones ? `<div class="reserva-acciones">${acciones}</div>` : ''}
            </div>
        `;
    },

    llamarReserva(tel, nombre) {
        Swal.fire({
            title: `LLAMAR A ${nombre || 'CLIENTE'}`,
            html: `<div style="font-size:2rem; font-weight:900; color:var(--hotel-blue); letter-spacing:2px;"><i class="fas fa-phone"></i> ${tel}</div>
                   <p style="margin-top:15px; color:#718096; font-size:0.85rem;">Llama para confirmar si vendrá. Si no contesta o no viene, usa <b>"NO VINO"</b> para liberar el cupo.</p>`,
            confirmButtonText: 'ENTENDIDO',
            confirmButtonColor: 'var(--hotel-blue)',
            background: 'var(--hotel-bg)'
        });
    },

    async confirmarReserva(reservaId) {
        const user = JSON.parse(localStorage.getItem('user'));
        try {
            const res = await api.post('/reservas/confirmar', { reservaId, usuarioId: user.UsuarioID });
            if (res.data.success) {
                window.Toast.fire({ icon: 'success', title: 'Reserva confirmada' });
                this.cargarReservas();
            }
        } catch (err) {
            Swal.fire({ icon: 'error', title: 'ERROR', text: err.response?.data?.error || 'No se pudo confirmar' });
        }
    },

    async cancelarReserva(reservaId) {
        const user = JSON.parse(localStorage.getItem('user'));
        const { value: motivo, isConfirmed } = await Swal.fire({
            title: '¿CANCELAR RESERVA?',
            input: 'text',
            inputLabel: 'Motivo (opcional)',
            inputPlaceholder: 'Ej: el cliente desistió',
            showCancelButton: true,
            confirmButtonText: 'SÍ, CANCELAR',
            cancelButtonText: 'NO',
            confirmButtonColor: 'var(--hotel-danger)',
            background: 'var(--hotel-bg)'
        });
        if (!isConfirmed) return;
        try {
            const res = await api.post('/reservas/cancelar', { reservaId, usuarioId: user.UsuarioID, motivo: motivo || '' });
            if (res.data.success) {
                window.Toast.fire({ icon: 'success', title: 'Reserva cancelada' });
                this.cargarReservas();
            }
        } catch (err) {
            Swal.fire({ icon: 'error', title: 'ERROR', text: err.response?.data?.error || 'No se pudo cancelar' });
        }
    },

    async marcarNoShow(reservaId) {
        const user = JSON.parse(localStorage.getItem('user'));
        const confirm = await Swal.fire({
            title: '¿EL CLIENTE NO VINO?',
            html: 'La reserva se marcará como <b>NO-SHOW</b> y el cupo quedará libre para alquilar a otra persona.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'SÍ, NO VINO',
            cancelButtonText: 'ESPERAR',
            confirmButtonColor: 'var(--hotel-warning)',
            background: 'var(--hotel-bg)'
        });
        if (!confirm.isConfirmed) return;
        try {
            const res = await api.post('/reservas/noshow', { reservaId, usuarioId: user.UsuarioID });
            if (res.data.success) {
                window.Toast.fire({ icon: 'success', title: 'Marcada como No-Show' });
                this.cargarReservas();
            }
        } catch (err) {
            Swal.fire({ icon: 'error', title: 'ERROR', text: err.response?.data?.error || 'No se pudo procesar' });
        }
    },

    // Convierte una reserva en check-in real: asigna un cuarto libre del tipo y precarga el modal
    async checkInDesdeReserva(reservaId) {
        try {
            const res = await api.get(`/reservas/detalle/${reservaId}`);
            const rv = res.data.reserva;
            if (!rv) return window.Toast.fire({ icon: 'error', title: 'Reserva no encontrada' });

            // Aseguramos rack fresco para ver cuartos libres del tipo reservado
            await this.cargarRack();
            const libres = this.habitacionesCache.filter(h =>
                (h.Estado === 'DISPONIBLE') &&
                (h.Categoria === rv.TipoNombre)
            );

            if (libres.length === 0) {
                return Swal.fire({
                    icon: 'warning',
                    title: 'SIN CUARTOS LIBRES',
                    html: `No hay habitaciones <b>${rv.TipoNombre || ''}</b> disponibles en este momento.<br>Revisa el rack o asigna otra cuando se libere una.`,
                    background: 'var(--hotel-bg)'
                });
            }

            // El receptionista elige cuál cuarto físico asignar
            const opciones = {};
            libres.forEach(h => { opciones[h.HabitacionID] = `Hab. ${h.NroHabitacion} (Piso ${h.Piso})`; });

            const { value: habId, isConfirmed } = await Swal.fire({
                title: 'ASIGNAR HABITACIÓN',
                html: `<p style="color:#718096; font-size:0.85rem; margin-bottom:10px;">Reserva de <b>${rv.NombreReserva}</b> · ${rv.TipoNombre || ''}</p>`,
                input: 'select',
                inputOptions: opciones,
                inputPlaceholder: 'Elige una habitación',
                showCancelButton: true,
                confirmButtonText: 'CONTINUAR AL CHECK-IN',
                cancelButtonText: 'CANCELAR',
                confirmButtonColor: 'var(--hotel-blue)',
                background: 'var(--hotel-bg)',
                inputValidator: (v) => !v ? 'Selecciona una habitación' : undefined
            });

            if (!isConfirmed || !habId) return;

            const hab = this.habitacionesCache.find(h => h.HabitacionID == habId);
            this.habSeleccionada = hab;

            // Abrimos el modal de check-in de siempre (resetea el form)
            this.abrirCheckIn(hab);

            // Marcamos que este check-in nace de una reserva
            const inResv = document.getElementById('in-reservaId');
            if (inResv) inResv.value = reservaId;

            // Precargamos datos del huésped que ya tenía la reserva
            document.getElementById('in-documento').value = rv.Documento || '';
            document.getElementById('in-nombre').value = rv.NombreReserva || '';
            document.getElementById('in-telefono').value = rv.Telefono || '';
            document.getElementById('in-correo').value = rv.Correo || '';

            // Si tenía documento, intentamos enriquecer desde la base/padrón
            if (rv.Documento) { try { await this.buscarCliente(); } catch (e) {} }

            // Las reservas son por día: fijamos tipo "Dia" y la cantidad de noches
            const inTipoAlq = document.getElementById('in-tipoAlquiler');
            if (inTipoAlq) inTipoAlq.value = 'Dia';

            const noches = this.calcularNochesEntre(rv.FechaLlegada, rv.FechaSalida);
            const inTiempo = document.getElementById('in-tiempo');
            if (inTiempo) inTiempo.value = noches;

            const inAdultos = document.getElementById('in-adultos');
            const inNinos = document.getElementById('in-ninos');
            if (inAdultos) inAdultos.value = rv.NroAdultos || 1;
            if (inNinos) inNinos.value = rv.NroNinos || 0;

            this.recalcularPrecios();

            document.getElementById('modalCheckInTitulo').textContent =
                `CHECK-IN RESERVA ${rv.CodigoReserva || ''} · HAB. ${hab.NroHabitacion}`;

            window.Toast.fire({ icon: 'info', title: 'Datos de la reserva precargados. Revisa y confirma el ingreso.' });
        } catch (err) {
            console.error(err);
            Swal.fire({ icon: 'error', title: 'ERROR', text: err.response?.data?.error || 'No se pudo iniciar el check-in' });
        }
    },

    calcularNochesEntre(llegada, salida) {
        try {
            const a = new Date((llegada || '').slice(0, 10));
            const b = new Date((salida || '').slice(0, 10));
            const n = Math.round((b - a) / 86400000);
            return Math.max(1, n);
        } catch (e) { return 1; }
    },

    // ----- Modal de Nueva Reserva (manual / teléfono) -----
    abrirModalNuevaReserva() {
        const form = document.getElementById('formNuevaReserva');
        if (form) form.reset();

        const hoy = new Date();
        const manana = new Date(); manana.setDate(manana.getDate() + 1);
        const fmt = (d) => d.toISOString().slice(0, 10);

        const inLleg = document.getElementById('nr-llegada');
        const inSal = document.getElementById('nr-salida');
        if (inLleg) inLleg.value = fmt(hoy);
        if (inSal) inSal.value = fmt(manana);

        const sel = document.getElementById('nr-tipo');
        if (sel) sel.innerHTML = '<option value="">-- Cargando disponibilidad... --</option>';

        document.getElementById('modalNuevaReserva').classList.remove('hidden');
        this.consultarDispReserva();
    },

    cerrarModalNuevaReserva() {
        document.getElementById('modalNuevaReserva').classList.add('hidden');
    },

    async consultarDispReserva() {
        const sedeId = localStorage.getItem('currentSedeId') || JSON.parse(localStorage.getItem('user')).SedeID;
        const desde = document.getElementById('nr-llegada').value;
        const hasta = document.getElementById('nr-salida').value;
        const sel = document.getElementById('nr-tipo');
        if (!desde || !hasta) return;

        if (hasta <= desde) {
            sel.innerHTML = '<option value="">La salida debe ser posterior a la llegada</option>';
            return;
        }

        sel.innerHTML = '<option value="">-- Consultando... --</option>';
        try {
            const res = await api.get(`/reservas/disponibilidad/${sedeId}?desde=${desde}&hasta=${hasta}`);
            const tipos = (res.data && res.data.tipos) ? res.data.tipos : [];
            const conCupo = tipos.filter(t => t.Disponibles > 0);

            if (conCupo.length === 0) {
                sel.innerHTML = '<option value="">Sin disponibilidad para esas fechas</option>';
                return;
            }

            sel.innerHTML = '<option value="">-- Elige un tipo --</option>' + conCupo.map(t =>
                `<option value="${t.TipoID}" data-total="${t.TotalEstimado}">
                    ${t.Descripcion} · $${parseFloat(t.PrecioBase).toFixed(2)}/noche · ${t.Disponibles} libre(s) · Total ~$${parseFloat(t.TotalEstimado).toFixed(2)}
                </option>`
            ).join('');
        } catch (err) {
            sel.innerHTML = '<option value="">Error consultando disponibilidad</option>';
            console.error(err);
        }
    },

    async guardarReservaInterna() {
        const user = JSON.parse(localStorage.getItem('user'));
        const sedeId = localStorage.getItem('currentSedeId') || user.SedeID;

        const payload = {
            sedeId: sedeId,
            usuarioId: user.UsuarioID,
            tipoId: document.getElementById('nr-tipo').value,
            nombre: document.getElementById('nr-nombre').value,
            documento: document.getElementById('nr-documento').value,
            telefono: document.getElementById('nr-telefono').value,
            correo: document.getElementById('nr-correo').value,
            fechaLlegada: document.getElementById('nr-llegada').value,
            fechaSalida: document.getElementById('nr-salida').value,
            nroAdultos: document.getElementById('nr-adultos').value,
            nroNinos: document.getElementById('nr-ninos').value,
            origen: document.getElementById('nr-origen').value,
            anticipoPagado: document.getElementById('nr-anticipo').value,
            notas: document.getElementById('nr-notas').value
        };

        if (!payload.tipoId) return window.Toast.fire({ icon: 'warning', title: 'Elige un tipo de habitación disponible' });
        if (!payload.nombre || payload.nombre.trim().length < 3) return window.Toast.fire({ icon: 'warning', title: 'Ingresa el nombre de quien reserva' });

        try {
            const res = await api.post('/reservas/interna', payload);
            if (res.data.success) {
                await Swal.fire({
                    icon: 'success',
                    title: 'RESERVA CREADA',
                    html: `Código: <b style="color:var(--hotel-gold); font-size:1.3rem;">${res.data.codigoReserva}</b>`,
                    background: 'var(--hotel-bg)'
                });
                this.cerrarModalNuevaReserva();
                this.cargarReservas();
            }
        } catch (err) {
            Swal.fire({ icon: 'error', title: 'NO SE PUDO GUARDAR', text: err.response?.data?.message || err.response?.data?.error || 'Error al crear la reserva' });
        }
    },

    // ==========================================
    // LISTENERS GENERALES
    // ==========================================
    setupEventListeners() {
        const formCheckin = document.getElementById('formCheckIn');
        if (formCheckin) {
            const inNac = document.getElementById('in-nacimiento');
            if(inNac) inNac.addEventListener('change', () => this.calcularEdad());

            const inDoc = document.getElementById('in-documento');
            if(inDoc) inDoc.onkeypress = (e) => { if (e.key === 'Enter') { e.preventDefault(); this.buscarCliente(); } };

            const inMetodo = document.getElementById('in-metodoPago');
            if(inMetodo) inMetodo.addEventListener('change', () => this.gestionarCamposVoucher());

            formCheckin.onsubmit = async (e) => {
                e.preventDefault();
                
                const esMigracion = document.getElementById('in-es-migracion') ? document.getElementById('in-es-migracion').checked : false;
                const abono = parseFloat(document.getElementById('in-montoAbono').value) || 0;
                
                if (!esMigracion && abono > 0 && !this.cajaId) {
                    return Swal.fire({ icon: 'error', title: 'CAJA CERRADA', text: 'Debe aperturar su turno de caja para recibir pagos.' });
                }

                const total = parseFloat(document.getElementById('ui-total-hospedaje').textContent.replace('$',''));
                const user = JSON.parse(localStorage.getItem('user'));
                const sedeId = localStorage.getItem('currentSedeId') || user.SedeID;

                const formData = new FormData();
                formData.append('sedeId', sedeId);
                formData.append('usuarioId', user.UsuarioID);
                formData.append('cajaId', this.cajaId);
                formData.append('habitacionId', document.getElementById('in-habitacionId').value);
                formData.append('esMigracion', esMigracion);

                // 🔧 FIX MIGRACIÓN: enviar la fecha histórica al backend (antes nunca se enviaba)
                if (esMigracion) {
                    const fechaMig = document.getElementById('in-fecha-ingreso-migracion').value;
                    if (!fechaMig) {
                        return Swal.fire({ icon: 'error', title: 'FALTA LA FECHA', text: 'Seleccione la fecha de ingreso real del huésped migrado.' });
                    }
                    // Mediodía local: evita el corrimiento de día por zona horaria (UTC-5)
                    formData.append('fechaIngreso', fechaMig + 'T12:00:00');
                }
                
                const tipoAlquiler = document.getElementById('in-tipoAlquiler').value;
                const tiempoInput = parseInt(document.getElementById('in-tiempo').value) || 1;
                
                let tiempoEnvioBackend = tiempoInput;
                if (tipoAlquiler === 'Momento') {
                    const horasBase = this.habSeleccionada.HorasMomento || 3;
                    tiempoEnvioBackend = tiempoInput * horasBase;
                }

                formData.append('tipoAlquiler', tipoAlquiler);
                formData.append('tiempoAsignado', tiempoEnvioBackend); 
                
                formData.append('totalHospedaje', total);
                
                // 🚗 AUTO-LINK: Vehículo y Parqueadero
                formData.append('placaVehiculo', document.getElementById('in-placa').value);
                formData.append('espacioParqueoId', document.getElementById('in-espacio-parqueo') ? document.getElementById('in-espacio-parqueo').value : '');

                formData.append('nroAdultos', document.getElementById('in-adultos').value);
                formData.append('nroNinos', document.getElementById('in-ninos').value);
                formData.append('acompanantes', JSON.stringify(this.acompanantesActuales));

                const clienteObj = {
                    Documento: document.getElementById('in-documento').value,
                    NombreFull: document.getElementById('in-nombre').value,
                    Telefono: document.getElementById('in-telefono').value,
                    Procedencia: document.getElementById('in-procedencia').value,
                    Correo: document.getElementById('in-correo').value,
                    FechaNacimiento: document.getElementById('in-nacimiento').value || null
                };
                formData.append('cliente', JSON.stringify(clienteObj));

                const pagoObj = {
                    Monto: abono,
                    MetodoID: document.getElementById('in-metodoPago').value,
                    Referencia: document.getElementById('in-referencia').value
                };
                formData.append('pago', JSON.stringify(pagoObj));

                // ====== NUEVO: si el check-in viene de una reserva, lo enviamos ======
                const reservaIdVal = document.getElementById('in-reservaId') ? document.getElementById('in-reservaId').value : '';
                if (reservaIdVal) formData.append('reservaId', reservaIdVal);

                const fileInput = document.getElementById('voucherFileRec');
                if (fileInput && fileInput.files[0]) formData.append('voucher', fileInput.files[0]);

                try {
                    const res = await api.post('/recepcion/checkin', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
                    if (res.data.success) {
                        await Swal.fire({ title: 'INGRESO EXITOSO', text: 'La habitación ha sido ocupada.', icon: 'success' });

                        // Cerradura inteligente: el código se genera fire-and-forget en el
                        // check-in, así que reintentamos un par de veces antes de mostrarlo.
                        this.mostrarCodigoAcceso(this.habSeleccionada.HabitacionID);

                        this.cerrarModal();
                        await this.cargarRack();
                        // Si venía de reserva, refrescamos la agenda para que salga como CHECKIN
                        if (reservaIdVal) this.cargarReservas();
                    }
                } catch (err) {
                    const msg = err.response?.data?.error || "Error en Check-In";
                    Swal.fire({ icon: 'error', title: 'FALLO OPERATIVO', text: msg });
                }
            };
        }

        const formPOS = document.getElementById('formPagoPOS');
        if(formPOS) {
            formPOS.onsubmit = (e) => this.procesarVentaPOS(e);
        }

        const inBarra = document.getElementById('in-buscador-pos');
        if(inBarra) {
            inBarra.addEventListener('keypress', (e) => this.procesarCodigoBarras(e));
            inBarra.addEventListener('input', () => this.buscarProductoPOS());
        }

        // ====== NUEVO: listener del formulario de Nueva Reserva ======
        const formNuevaReserva = document.getElementById('formNuevaReserva');
        if (formNuevaReserva) {
            formNuevaReserva.onsubmit = (e) => { e.preventDefault(); this.guardarReservaInterna(); };
        }

        const formCheckout = document.getElementById('formCheckout');
        if(formCheckout) {
            const outMetodo = document.getElementById('out-metodoPago');
            if(outMetodo) outMetodo.addEventListener('change', () => this.gestionarCamposVoucherOut());

            const checkFactura = document.getElementById('out-generar-factura');
            if (checkFactura) {
                checkFactura.addEventListener('change', () => this.toggleOpcionesFactura());
            }

            formCheckout.onsubmit = async (e) => {
                e.preventDefault();
                
                const saldoPendiente = parseFloat(document.getElementById('out-saldo-pendiente').textContent.replace('$','')) || 0;

                // Monto realmente cobrado en la salida (puede ser parcial o cero)
                let cobrado = parseFloat(document.getElementById('out-montoAbono').value) || 0;
                if (cobrado < 0) cobrado = 0;
                if (cobrado > saldoPendiente) cobrado = saldoPendiente;
                const deudaRestante = +(saldoPendiente - cobrado).toFixed(2);

                if (cobrado > 0 && !this.cajaId) {
                    return Swal.fire({ icon: 'error', title: 'CAJA CERRADA', text: 'Debe aperturar caja para registrar el cobro del saldo.' });
                }

                const requiereFactura = document.getElementById('out-generar-factura') && document.getElementById('out-generar-factura').checked;

                const metodoID = document.getElementById('out-metodoPago') ? document.getElementById('out-metodoPago').value : '1';
                let formaPagoSRI = '01'; 
                if (metodoID === '2' || metodoID === '3') {
                    formaPagoSRI = '20'; 
                }

                let textoConfirmacion = requiereFactura 
                    ? "La habitación pasará a estado de Limpieza, se cerrará la cuenta y se <b>EMITIRÁ FACTURA ELECTRÓNICA SRI</b>." 
                    : "La habitación pasará a estado de Limpieza y se cerrará la cuenta con <b>recibo interno</b>.";

                if (deudaRestante > 0) {
                    textoConfirmacion += `<br><br><div style="background:#fff3f3; border:1px solid var(--hotel-danger); border-radius:10px; padding:10px; color:var(--hotel-danger); font-weight:bold; font-size:0.85rem;">
                        ⚠️ El cliente se va debiendo <b>$${deudaRestante.toFixed(2)}</b>.<br>
                        Se registrará como DEUDA a su nombre (saldrá en el reporte de deudores y se avisará la próxima vez que se hospede).</div>`;
                }

                const confirm = await Swal.fire({
                    title: deudaRestante > 0 ? '¿Liberar con DEUDA pendiente?' : '¿Confirmar Salida?',
                    html: textoConfirmacion,
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: deudaRestante > 0 ? '#e74c3c' : '#1a365d',
                    cancelButtonColor: '#95a5a6',
                    confirmButtonText: deudaRestante > 0 ? 'Sí, liberar y dejar deuda' : 'Sí, procesar Check-Out',
                    background: 'var(--hotel-bg)'
                });

                if (!confirm.isConfirmed) return;

                const user = JSON.parse(localStorage.getItem('user'));
                const sedeId = localStorage.getItem('currentSedeId') || user.SedeID;

                const formData = new FormData();
                formData.append('recepcionId', this.folioActual.recepcion.RecepcionID);
                formData.append('habitacionId', this.habSeleccionada.HabitacionID);
                formData.append('cajaId', this.cajaId);

                if (cobrado > 0) {
                    const pagoFinal = {
                        Monto: cobrado,
                        MetodoID: document.getElementById('out-metodoPago').value,
                        Referencia: document.getElementById('out-referencia').value
                    };
                    formData.append('pagoFinal', JSON.stringify(pagoFinal));

                    const fileInput = document.getElementById('voucherFileOut');
                    if (fileInput && fileInput.files[0]) formData.append('voucher', fileInput.files[0]);
                }

                try {
                    const res = await api.post('/recepcion/checkout', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
                    
                    if (res.data.success) {
                        if (requiereFactura) {
                            Swal.fire({ title: 'Firmando Factura...', text: 'Conectando con el motor SRI...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                            try {
                                const resFac = await api.post('/facturacion/documento/emitir-hospedaje', {
                                    RecepcionID: this.folioActual.recepcion.RecepcionID,
                                    UsuarioID: user.UsuarioID,
                                    SedeID: sedeId,
                                    FormaPago: formaPagoSRI
                                });
                                
                                if (resFac.data.success) {
                                    await Swal.fire({ title: 'SALIDA Y FACTURACIÓN EXITOSA', text: 'El huésped se ha retirado y la factura fue firmada.', icon: 'success' });
                                }
                            } catch (errFac) {
                                const msgF = errFac.response?.data?.error || "Error al emitir factura SRI";
                                await Swal.fire({ icon: 'warning', title: 'CHECK-OUT LISTO, PERO FALLÓ FACTURA', text: msgF });
                            }
                        } else {
                            await Swal.fire({ title: res.data.conDeuda ? 'SALIDA CON DEUDA REGISTRADA' : 'SALIDA EXITOSA', text: res.data.message || 'El huésped se ha retirado. Habitación en Limpieza y Parqueadero liberado.', icon: res.data.conDeuda ? 'warning' : 'success', background: 'var(--hotel-bg)' });
                        }
                        
                        this.cerrarModalCheckout();
                        await this.cargarRack();
                    }
                } catch (err) {
                    const msg = err.response?.data?.error || "Error al procesar Check-Out";
                    Swal.fire({ icon: 'error', title: 'FALLO OPERATIVO', text: msg });
                }
            };
        }
    },

    cerrarModal() { document.getElementById('modalCheckIn').classList.add('hidden'); }
};

module.exports = RecepcionModule;