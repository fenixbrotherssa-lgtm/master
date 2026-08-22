// modules/limpieza-movil.js
const api = require('./api');

const LimpiezaMovilModule = {
    habitaciones: [],
    pisos: [],
    pisoSeleccionado: 'TODOS',
    habSeleccionada: null,
    sedeId: null,

    async init() {
        console.log("🧹 Módulo de Mantenimiento y Limpieza de Campo Inicializado...");

        // Extraer SedeID del contexto del usuario logueado
        const user = JSON.parse(localStorage.getItem('user'));
        this.sedeId = localStorage.getItem('currentSedeId') || user?.SedeID || user?.sedeId;

        if (!this.sedeId) {
            Swal.fire("Error de Contexto", "No se detectó una sede activa asignada a tu perfil.", "error");
            return;
        }

        await this.cargarHabitaciones();
        this.setupSocket();
    },

    setupSocket() {
        if (!window.socket) return;
        window.socket.on('habitacion:cambio', () => {
            this.cargarHabitaciones();
        });
    },

    async cargarHabitaciones() {
        try {
            // Consumimos el Rack desde la ruta de recepción protegida por tu verifyToken
            const res = await api.get(`/recepcion/rack/${this.sedeId}`);
            this.habitaciones = res.data;

            // Procesar pisos únicos para los filtros de la barra horizontal
            const pisosSet = new Set(this.habitaciones.map(h => h.Piso));
            this.pisos = Array.from(pisosSet).sort((a, b) => a - b);

            this.renderFiltrosPisos();
            this.renderRack();
        } catch (err) {
            console.error("❌ Error al sincronizar el rack móvil de limpieza:", err.response?.data || err.message || err);
            if (window.Toast) {
                window.Toast.fire({ 
                    icon: 'error', 
                    title: 'Error de Sincronización',
                    text: err.response?.data?.error || 'El servidor local no responde.' 
                });
            }
        }
    },

    renderFiltrosPisos() {
        const container = document.getElementById('clean-filtros-pisos');
        if (!container) return;

        let html = `<button onclick="LimpiezaMovilModule.cambiarPiso('TODOS')" class="btn-neo-filter ${this.pisoSeleccionado === 'TODOS' ? 'active' : ''}">TODOS</button>`;
        
        this.pisos.forEach(piso => {
            html += `<button onclick="LimpiezaMovilModule.cambiarPiso('${piso}')" class="btn-neo-filter ${this.pisoSeleccionado == piso ? 'active' : ''}">PISO ${piso}</button>`;
        });

        container.innerHTML = html;
    },

    cambiarPiso(piso) {
        this.pisoSeleccionado = piso;
        this.renderFiltrosPisos();
        this.renderRack();
    },

    renderRack() {
        const grid = document.getElementById('grid-limpieza-habitaciones');
        if (!grid) return;

        // Filtrar según el piso seleccionado
        const habsFiltradas = this.habitaciones.filter(h => {
            return this.pisoSeleccionado === 'TODOS' || String(h.Piso) === String(this.pisoSeleccionado);
        });

        if (habsFiltradas.length === 0) {
            grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:#718096; opacity:0.6;">Sin habitaciones en este piso</div>`;
            return;
        }

        grid.innerHTML = habsFiltradas.map(h => {
            const estadoClase = h.Estado.toLowerCase();
            return `
                <div class="card-habitacion-clean" onclick="LimpiezaMovilModule.abrirAcciones(${h.HabitacionID})">
                    <span class="badge-estado-clean estado-${estadoClase}">${h.Estado}</span>
                    <div style="margin-top: 15px;">
                        <span style="font-size: 0.75rem; font-weight: 900; color: #718096; display: block; text-transform: uppercase;">${h.Categoria || 'Habitación'}</span>
                        <strong style="font-size: 1.6rem; color: #1a365d; font-weight: 900;">#${h.NroHabitacion}</strong>
                    </div>
                    <div style="margin-top: 15px; font-size: 0.8rem; color: #4a5568; font-weight: 600;">
                        <i class="fas fa-layer-group" style="margin-right: 4px;"></i> Piso ${h.Piso}
                    </div>
                </div>
            `;
        }).join('');
    },

    abrirAcciones(id) {
        const hab = this.habitaciones.find(h => h.HabitacionID === id);
        if (!hab) return;

        this.habSeleccionada = hab;

        document.getElementById('modal-clean-titulo').textContent = `Habitación #${hab.NroHabitacion}`;
        
        const badgeEstado = document.getElementById('modal-clean-estado-actual');
        badgeEstado.textContent = hab.Estado;
        badgeEstado.className = `estado-${hab.Estado.toLowerCase()}`;
        badgeEstado.style.padding = '15px';

        // Limpiar campo de texto para averías previas
        document.getElementById('clean-obs-averia').value = '';

        const modal = document.getElementById('modal-accion-habitacion');
        modal.style.display = 'flex';
    },

    cerrarModal() {
        document.getElementById('modal-accion-habitacion').style.display = 'none';
        this.habSeleccionada = null;
    },

    async cambiarEstado(nuevoEstado) {
        if (!this.habSeleccionada) return;

        try {
            // 1. OBTENER EL MOLDE MAESTRO: Buscamos la habitación con todas sus columnas reales (Precios, TipoID, SedeID)
            const resMaestro = await api.get(`/habitaciones/sede/${this.sedeId}`);
            const habCompleta = resMaestro.data.find(h => h.HabitacionID === this.habSeleccionada.HabitacionID);

            if (!habCompleta) {
                throw new Error("No se pudo mapear la integridad estructural de la habitación.");
            }

            // 2. ENVIAR ACTUALIZACIÓN BLINDADA: Enviamos el registro completo variando únicamente el Estado
            const res = await api.post('/habitaciones', {
                ...habCompleta,
                Estado: nuevoEstado
            });

            if (res.data.success) {
                if (window.Toast) window.Toast.fire({ icon: 'success', title: `HABITACIÓN ACTUALIZADA A ${nuevoEstado}` });
                this.cerrarModal();
                await this.cargarHabitaciones();
            }
        } catch (err) {
            console.error("❌ Fallo al mutar el estado de la habitación en backend:", err.response?.data || err.message || err);
            
            const errorMsg = err.response?.data?.error || err.response?.data?.message || "No se pudo actualizar el estado físico.";
            Swal.fire({
                title: "Fallo Operativo",
                text: errorMsg,
                icon: "error",
                confirmButtonColor: "var(--hotel-blue)"
            });
        }
    },

    async enviarReporteAveria() {
        if (!this.habSeleccionada) return;
        const observaciones = document.getElementById('clean-obs-averia').value.trim();

        if (!observaciones) {
            if (window.Toast) window.Toast.fire({ icon: 'warning', title: 'Escriba el daño detectado' });
            return;
        }

        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const usuarioId = user?.UsuarioID || user?.id || null;

            // 1. OBTENER EL MOLDE MAESTRO preventivo para no romper campos obligatorios
            const resMaestro = await api.get(`/habitaciones/sede/${this.sedeId}`);
            const habCompleta = resMaestro.data.find(h => h.HabitacionID === this.habSeleccionada.HabitacionID);

            if (!habCompleta) {
                throw new Error("No se pudo mapear la integridad estructural para el bloqueo técnico.");
            }

            // 2. Mutar el estado de la habitación a MANTENIMIENTO usando el molde maestro
            await api.post('/habitaciones', {
                ...habCompleta,
                Estado: 'MANTENIMIENTO'
            });

            // 3. Registrar el movimiento en la bitácora de activos usando el formato de tu activosCtrl
            await api.post('/activos/movimientos', {
                ActivoID: this.habSeleccionada.HabitacionID, 
                TipoMovimiento: 'MANTENIMIENTO',
                SedeOrigenID: this.sedeId,
                UsuarioID: usuarioId,
                Observaciones: `REPORTE DESDE APP MÓVIL: ${observaciones}`,
                Responsable: user?.NombreFull || 'PERSONAL MANTENIMIENTO'
            });

            if (window.Toast) window.Toast.fire({ icon: 'success', title: 'HABITACIÓN ENVIADA A TALLER' });
            this.cerrarModal();
            await this.cargarHabitaciones();
        } catch (err) {
            console.error("❌ Fallo al registrar flujo completo de avería:", err.response?.data || err.message || err);
            
            const dbError = err.response?.data?.error || err.response?.data?.message || "La bitácora de activos rechazó el reingreso.";
            Swal.fire({
                title: "Error de Registro",
                text: `La acción se interrumpió: ${dbError}`,
                icon: "warning",
                confirmButtonColor: "var(--hotel-blue)"
            });
        }
    }
};

module.exports = LimpiezaMovilModule;