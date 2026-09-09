const api = require('./api');

const HabitacionesModule = {
    tipos: [],
    habitaciones: [],
    sedeId: null,
    isAdmin: false, // Control global de privilegios administrativos

    async init() {
        console.log("HabitacionesModule: Ejecutando inicialización completa...");
        
        const isSuperAdmin = window.App && window.App.isSuperAdmin();
        const user = JSON.parse(localStorage.getItem('user'));

        // Determinar si el usuario actual tiene rol administrativo (RolID === 1)
        this.isAdmin = isSuperAdmin || (user && user.RolID === 1);

        const btnDesactivadas = document.getElementById('btnVerDesactivadas');
        if (btnDesactivadas) btnDesactivadas.classList.toggle('hidden', !this.isAdmin);

        // 1. Carga preventiva de infraestructura
        if (isSuperAdmin && (!window.App.sedes || window.App.sedes.length === 0)) {
            try {
                await window.App.fetchSedes();
            } catch (error) {
                console.error("Fallo crítico en fetchSedes:", error);
            }
        }

        // 2. Resolución de SedeID
        this.sedeId = localStorage.getItem('currentSedeId') || user?.SedeID;

        // 3. Inyección del selector
        if (isSuperAdmin) {
            window.App.renderSedeSelector('sedeSelectorContainer', (newSedeId) => {
                this.sedeId = newSedeId;
                this.cargarDatos();
            });
        }

        // 4. Validación de seguridad
        if (!this.sedeId && !isSuperAdmin) {
            if(window.Toast) {
                window.Toast.fire({ 
                    icon: 'error', 
                    title: 'Restricción de Acceso',
                    text: 'No se detectó una sede vinculada a su cuenta.' 
                });
            }
            return;
        }

        // 5. Carga de datos y configuración de UI
        setTimeout(async () => {
            await this.cargarDatos();
            this.setupForms();
        }, 50);

        this.setupSocket();
        window.HabitacionesModule = this;
    },

    setupSocket() {
        if (!window.socket) return;
        window.socket.on('habitacion:cambio', () => {
            this.cargarDatos();
        });
    },

    async cargarDatos() {
        if (!this.sedeId) return;

        try {
            console.log(`Sync: Recuperando inventario para SedeID ${this.sedeId}`);
            const [resTipos, resHabs] = await Promise.all([
                api.get(`/habitaciones/tipos/${this.sedeId}`),
                api.get(`/habitaciones/sede/${this.sedeId}`)
            ]);

            this.tipos = resTipos.data || [];
            this.habitaciones = resHabs.data || [];

            this.renderTipos();
            this.renderHabitaciones();
            this.llenarSelectTipos();
        } catch (err) {
            console.error("Error en sincronización de inventario:", err);
            if(window.Toast) window.Toast.fire({ icon: 'error', title: 'Error de comunicación con el servidor' });
        }
    },

    renderHabitaciones() {
        const grid = document.getElementById('gridHabitaciones');
        if (!grid) return;

        // Caso: No hay habitaciones registradas
        if (this.habitaciones.length === 0) {
            grid.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 60px; color: #718096; font-weight: 800;">
                    <i class="fas fa-bed" style="font-size: 3.5rem; display: block; margin-bottom: 20px; opacity: 0.3;"></i>
                    SIN REGISTROS DISPONIBLES EN ESTA SEDE
                </div>`;
            return;
        }

        // 1. Agrupar habitaciones por número de piso
        const habitacionesPorPiso = this.habitaciones.reduce((acc, h) => {
            const nivel = h.Piso || "S/N"; // Manejo de habitaciones sin piso asignado
            if (!acc[nivel]) acc[nivel] = [];
            acc[nivel].push(h);
            return acc;
        }, {});

        // 2. Obtener los pisos y ordenarlos numéricamente
        const pisosOrdenados = Object.keys(habitacionesPorPiso).sort((a, b) => a - b);

        // 3. Generar el HTML estructurado por secciones de piso
        grid.innerHTML = pisosOrdenados.map(piso => `
            <div class="piso-container" style="width: 100%; margin-bottom: 40px;">
                <h3 style="color: var(--hotel-blue); border-bottom: 2px solid var(--hotel-gold); padding-bottom: 10px; margin-bottom: 25px; font-weight: 900; display: flex; align-items: center; gap: 15px; text-transform: uppercase; letter-spacing: 1px;">
                    <i class="fas fa-layer-group" style="color: var(--hotel-gold);"></i> 
                    Nivel ${piso}
                    <span style="font-size: 0.7rem; background: var(--hotel-blue); color: white; padding: 4px 12px; border-radius: 20px; font-weight: 600;">
                        ${habitacionesPorPiso[piso].length} Unidades
                    </span>
                </h3>
                
                <div class="habitaciones-piso-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 25px;">
                    ${habitacionesPorPiso[piso].map(h => {
                        // Definición de colores según el estado operativo
                        let colorStatus = '#2ecc71'; // DISPONIBLE
                        if(h.Estado === 'OCUPADA') colorStatus = '#e74c3c';
                        if(h.Estado === 'MANTENIMIENTO') colorStatus = '#f1c40f';
                        if(h.Estado === 'LIMPIEZA') colorStatus = '#3498db';

                        return `
                        <div class="room-card animate__animated animate__fadeInUp" style="position:relative;" onclick="HabitacionesModule.editarHab(${h.HabitacionID})">
                            ${this.isAdmin ? `
                            <button class="btn-neo" title="Eliminar" style="position:absolute; top:8px; right:8px; padding:5px 8px; color:#e74c3c; box-shadow:none;" onclick="event.stopPropagation(); HabitacionesModule.eliminarHab(${h.HabitacionID}, '${h.NroHabitacion}')">
                                <i class="fas fa-trash" style="font-size:0.75rem;"></i>
                            </button>` : ''}
                            <div class="status-badge" style="background: ${colorStatus}; box-shadow: 0 0 10px ${colorStatus};"></div>
                            <p style="margin:0; font-size:0.65rem; opacity:0.8; font-weight: 800;">${h.TipoNombre || 'SIN CATEGORÍA'}</p>
                            <h3 style="margin:8px 0; font-size:1.8rem; color: var(--hotel-blue); font-weight: 900;">${h.NroHabitacion}</h3>
                            <div style="margin-top:10px; color: #007bff; font-weight: 900; font-size: 1.2rem;">$${h.PrecioDia}</div>
                            <div style="font-size:0.6rem; margin-top:8px; font-weight: 700; color: #7f8c8d; text-transform: uppercase;">${h.Estado}</div>
                        </div>`;
                    }).join('')}
                </div>
            </div>
        `).join('');
    },

    renderTipos() {
        const body = document.getElementById('tablaTiposBody');
        if (!body) return;

        // Renderizado de la tabla de categorías/tarifario
        body.innerHTML = this.tipos.map(t => `
            <tr style="background: #f1f3f5;">
                <td style="padding:15px; border-radius:15px 0 0 15px; font-weight:800; color: var(--hotel-blue);">${t.Descripcion}</td>
                <td style="color: #4a5568; font-weight: 600;"><i class="fas fa-users" style="margin-right: 8px; color: var(--hotel-gold);"></i>${t.CapacidadAdultos} Ad + ${t.CapacidadNiños} Ni</td>
                <td style="font-weight:900; color:#007bff; font-size: 1.1rem;">$${t.PrecioBase}</td>
                <td style="text-align:center; border-radius:0 15px 15px 0;">
                    <button class="btn-neo" style="display:inline-flex; padding:10px; cursor:pointer;" onclick="HabitacionesModule.editarTipo(${t.TipoID})">
                        <i class="fas fa-edit"></i>
                    </button>
                    ${this.isAdmin ? `
                    <button class="btn-neo" style="display:inline-flex; padding:10px; cursor:pointer; color:#e74c3c;" onclick="HabitacionesModule.eliminarTipo(${t.TipoID}, '${t.Descripcion}')">
                        <i class="fas fa-trash"></i>
                    </button>` : ''}
                </td>
            </tr>
        `).join('');
    },

    llenarSelectTipos() {
        const select = document.getElementById('tipoIdSelect');
        if (select) {
            select.innerHTML = '<option value="">-- SELECCIONE CATEGORÍA --</option>' + 
                this.tipos.map(t => `<option value="${t.TipoID}">${t.Descripcion}</option>`).join('');
        }
    },

    switchTab(tab) {
        const tabHab = document.getElementById('tabHabitaciones');
        const tabTipos = document.getElementById('tabTipos');
        const btnHab = document.getElementById('btnTabHab');
        const btnTipos = document.getElementById('btnTabTipos');

        if (tabHab) tabHab.classList.toggle('hidden', tab !== 'hab');
        if (tabTipos) tabTipos.classList.toggle('hidden', tab !== 'tipos');
        if (btnHab) btnHab.classList.toggle('active', tab === 'hab');
        if (btnTipos) btnTipos.classList.toggle('active', tab === 'tipos');
    },

    abrirModalHab(data = null) {
        // Bloquear creación manual si no posee rol de administrador
        if (!this.isAdmin && !data) {
            if(window.Toast) {
                window.Toast.fire({ icon: 'error', title: 'Restricción', text: 'No tiene permisos para dar de alta nuevas unidades.' });
            }
            return;
        }

        const modal = document.getElementById('modalHabitacion');
        const form = document.getElementById('formHabitacion');
        if (!modal || !form) return;

        form.reset();
        document.getElementById('habitacionId').value = '';
        
        if (data) {
            document.getElementById('habitacionId').value = data.HabitacionID;
            document.getElementById('nroHabitacion').value = data.NroHabitacion;
            document.getElementById('pisoHab').value = data.Piso;
            document.getElementById('tipoIdSelect').value = data.TipoID;
            document.getElementById('estadoHab').value = data.Estado;
            document.getElementById('precioDia').value = data.PrecioDia;
            document.getElementById('precioMomento').value = data.PrecioMomento;
            document.getElementById('precioPeriodo').value = data.PrecioPeriodo;
            document.getElementById('horasMomentoHab').value = data.HorasMomento || 3;
            document.getElementById('observacionesHab').value = data.Observaciones || '';
            const chkMb = document.getElementById('tieneMinibarHab');
            if (chkMb) chkMb.checked = !!data.TieneMinibar;
        } else {
            const chkMb = document.getElementById('tieneMinibarHab');
            if (chkMb) chkMb.checked = false;
        }

        // --- Gestión dinámica de edición según privilegios ---
        const camposGenerales = [
            'nroHabitacion', 'pisoHab', 'tipoIdSelect',
            'precioDia', 'precioMomento', 'precioPeriodo',
            'horasMomentoHab', 'observacionesHab', 'tieneMinibarHab'
        ];

        // Deshabilitar los campos de configuración general si no es administrador
        camposGenerales.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = !this.isAdmin;
        });

        // Asegurar que el selector de estado permanezca editable para todo el personal
        const elEstado = document.getElementById('estadoHab');
        if (elEstado) elEstado.disabled = false;

        modal.classList.remove('hidden');
    },

    abrirModalTipo(data = null) {
        // Bloquear completamente la alteración de categorías tarifarias a no-administradores
        if (!this.isAdmin) {
            if(window.Toast) {
                window.Toast.fire({ icon: 'error', title: 'Acceso Denegado', text: 'Solo los administradores pueden modificar los esquemas de categorías.' });
            }
            return;
        }

        const modal = document.getElementById('modalTipoHabitacion');
        const form = document.getElementById('formTipoHabitacion');
        if (!modal || !form) return;

        form.reset();
        document.getElementById('tipoId').value = '';

        if (data) {
            document.getElementById('tipoId').value = data.TipoID;
            document.getElementById('descTipo').value = data.Descripcion;
            document.getElementById('precioBaseTipo').value = data.PrecioBase;
            document.getElementById('capAdultos').value = data.CapacidadAdultos;
            document.getElementById('capNinos').value = data.CapacidadNiños;
        }
        modal.classList.remove('hidden');
    },

    async eliminarHab(id, nro) {
        if (!this.isAdmin) return;

        const result = await Swal.fire({
            title: `¿Eliminar habitación ${nro}?`,
            text: "Si nunca ha tenido check-ins ni reservas se borra por completo. Si ya tiene historial, se desactivará en su lugar para no perderlo.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sí, continuar',
            cancelButtonText: 'Cancelar',
            background: '#e0e0e4'
        });
        if (!result.isConfirmed) return;

        try {
            const res = await api.delete(`/habitaciones/${id}`);
            await this.cargarDatos();
            Swal.fire(res.data.desactivada ? 'Desactivada' : 'Eliminada', res.data.message, 'success');
        } catch (e) {
            Swal.fire('Error', e.response?.data?.error || 'No se pudo eliminar la habitación', 'error');
        }
    },

    async verDesactivadas() {
        if (!this.isAdmin || !this.sedeId) return;

        try {
            const res = await api.get(`/habitaciones/desactivadas/${this.sedeId}`);
            const desactivadas = res.data || [];

            if (desactivadas.length === 0) {
                Swal.fire('Sin registros', 'No hay habitaciones desactivadas en esta sede.', 'info');
                return;
            }

            const html = `
                <div style="text-align:left; max-height:400px; overflow-y:auto;">
                    ${desactivadas.map(h => `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; margin-bottom:8px; background:#f1f3f5; border-radius:10px;">
                            <div>
                                <strong>${h.NroHabitacion}</strong>
                                <span style="font-size:0.75rem; color:#7f8c8d;"> — ${h.TipoNombre || 'Sin categoría'} (Piso ${h.Piso ?? 'S/N'})</span>
                            </div>
                            <button class="btn-neo" style="padding:6px 12px;" onclick="HabitacionesModule.reactivarHab(${h.HabitacionID})">
                                <i class="fas fa-undo"></i> Reactivar
                            </button>
                        </div>
                    `).join('')}
                </div>`;

            Swal.fire({
                title: 'Habitaciones desactivadas',
                html,
                showConfirmButton: false,
                showCloseButton: true,
                background: '#e0e0e4',
                width: 500
            });
        } catch (e) {
            Swal.fire('Error', e.response?.data?.error || 'No se pudo cargar las habitaciones desactivadas', 'error');
        }
    },

    async reactivarHab(id) {
        try {
            await api.post(`/habitaciones/${id}/reactivar`);
            Swal.close();
            await this.cargarDatos();
            window.Toast.fire({ icon: 'success', title: 'Habitación reactivada' });
        } catch (e) {
            Swal.fire('Error', e.response?.data?.error || 'No se pudo reactivar la habitación', 'error');
        }
    },

    async eliminarTipo(id, nombre) {
        if (!this.isAdmin) return;

        const result = await Swal.fire({
            title: `¿Eliminar categoría "${nombre}"?`,
            text: "Esto fallará si hay habitaciones vinculadas a esta categoría.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sí, eliminar',
            cancelButtonText: 'Cancelar',
            background: '#e0e0e4'
        });
        if (!result.isConfirmed) return;

        try {
            await api.delete(`/habitaciones/tipos/${id}`);
            await this.cargarDatos();
            Swal.fire('Eliminada', 'La categoría ha sido borrada.', 'success');
        } catch (e) {
            Swal.fire('Error', e.response?.data?.error || 'No se pudo eliminar la categoría', 'error');
        }
    },

    cerrarModales() {
        document.querySelectorAll('.modal-neo').forEach(m => m.classList.add('hidden'));
    },

    setupForms() {
        const formHab = document.getElementById('formHabitacion');
        if (formHab) {
            formHab.onsubmit = async (e) => {
                e.preventDefault();
                // Observación técnica: los elementos con 'disabled' son legibles mediante JS (.value), 
                // asegurando la persistencia sin alterar el mapeo del controlador de la base de datos.
                const payload = {
                    HabitacionID: document.getElementById('habitacionId').value || null,
                    SedeID: this.sedeId,
                    TipoID: document.getElementById('tipoIdSelect').value,
                    NroHabitacion: document.getElementById('nroHabitacion').value,
                    Piso: document.getElementById('pisoHab').value,
                    Estado: document.getElementById('estadoHab').value,
                    PrecioDia: document.getElementById('precioDia').value,
                    PrecioMomento: document.getElementById('precioMomento').value,
                    PrecioPeriodo: document.getElementById('precioPeriodo').value,
                    HorasMomento: document.getElementById('horasMomentoHab').value,
                    Observaciones: document.getElementById('observacionesHab').value,
                    TieneMinibar: document.getElementById('tieneMinibarHab') && document.getElementById('tieneMinibarHab').checked ? 1 : 0
                };

                try {
                    const res = await api.post('/habitaciones', payload);
                    if (res.data.success) {
                        this.cerrarModales();
                        await this.cargarDatos();
                        if(window.Toast) window.Toast.fire({ icon: 'success', title: 'Inventario Actualizado' });
                    }
                } catch (err) { 
                    console.error("Error en persistencia:", err);
                    if(window.Toast) window.Toast.fire({ icon: 'error', title: 'Fallo al procesar registro' });
                }
            };
        }

        const formTipo = document.getElementById('formTipoHabitacion');
        if (formTipo) {
            formTipo.onsubmit = async (e) => {
                e.preventDefault();
                const payload = {
                    TipoID: document.getElementById('tipoId').value || null,
                    SedeID: this.sedeId,
                    Descripcion: document.getElementById('descTipo').value,
                    PrecioBase: document.getElementById('precioBaseTipo').value,
                    CapacidadAdultos: document.getElementById('capAdultos').value,
                    CapacidadNiños: document.getElementById('capNinos').value,
                    AmenidadesJSON: [] 
                };

                try {
                    const res = await api.post('/habitaciones/tipos', payload);
                    if (res.data.success) {
                        this.cerrarModales();
                        await this.cargarDatos();
                        if(window.Toast) window.Toast.fire({ icon: 'success', title: 'Categoría Sincronizada' });
                    }
                } catch (err) {
                    if(window.Toast) window.Toast.fire({ icon: 'error', title: 'Fallo al procesar categoría' });
                }
            };
        }
    },

    editarHab(id) {
        const item = this.habitaciones.find(h => h.HabitacionID === id);
        if (item) this.abrirModalHab(item);
    },

    editarTipo(id) {
        const item = this.tipos.find(t => t.TipoID === id);
        if (item) this.abrirModalTipo(item);
    }
};

module.exports = HabitacionesModule;