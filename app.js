const fs = require('fs');
const path = require('path');
const api = require('./modules/api');
const { io } = require('socket.io-client');

const App = {
    user: JSON.parse(localStorage.getItem('user')) || null,
    sedes: [], 

    async init() {
        console.log("SystemCore: Iniciando...");
        if (!this.user) {
            this.renderView('login', 'app-root');
        } else {
            if (this.isSuperAdmin()) {
                await this.fetchSedes();
            }
            this.conectarSocket();
            this.renderShell();
        }
    },

    conectarSocket() {
        const baseUrl = (window.AppConfig && window.AppConfig.apiUrl)
            ? window.AppConfig.apiUrl.replace('/api', '')
            : 'http://localhost:4000';
        const sedeId = localStorage.getItem('currentSedeId') || (this.user ? this.user.SedeID : '');

        window.socket = io(baseUrl, {
            query: { sedeId },
            transports: ['websocket'],
            reconnectionDelay: 3000,
            reconnectionAttempts: Infinity
        });

        window.socket.on('connect', () => {
            console.log('🔌 Socket conectado al servidor');
            const ind = document.getElementById('socket-status-indicator');
            if (ind) { ind.style.background = '#27ae60'; ind.title = 'Conectado'; }
        });

        window.socket.on('disconnect', (reason) => {
            console.warn('🔌 Socket desconectado:', reason);
            const ind = document.getElementById('socket-status-indicator');
            if (ind) { ind.style.background = '#e74c3c'; ind.title = 'Sin conexión con servidor'; }
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: 'Sin conexión con el servidor',
                    text: 'Reconectando automáticamente...',
                    icon: 'warning', timer: 4000, timerProgressBar: true,
                    position: 'top-end', toast: true, showConfirmButton: false
                });
            }
        });

        window.socket.on('reconnect', (attempt) => {
            console.log(`🔌 Socket reconectado (intento ${attempt})`);
            const ind = document.getElementById('socket-status-indicator');
            if (ind) { ind.style.background = '#27ae60'; ind.title = 'Conectado'; }
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: 'Conexión restaurada',
                    icon: 'success', timer: 3000, timerProgressBar: true,
                    position: 'top-end', toast: true, showConfirmButton: false
                });
            }
            // Refrescar datos del módulo activo para recuperar cambios perdidos
            if (window.RestauranteModule && typeof window.RestauranteModule.cargarMesas === 'function') {
                window.RestauranteModule.cargarMesas();
                window.RestauranteModule.actualizarBadgeCocina();
            }
            if (window.HabitacionesModule && typeof window.HabitacionesModule.cargarHabitaciones === 'function') {
                window.HabitacionesModule.cargarHabitaciones();
            }
        });

        // Buffer global persistente para pedidos Room Service (POS ALIMENTO).
        // Se registra aquí para no perderse eventos al cambiar de módulo.
        if (!window._pedidosPosDesktop) window._pedidosPosDesktop = [];
        if (!window._pedidosPosDesktopEntregados) window._pedidosPosDesktopEntregados = [];

        window.socket.on('nueva_reserva', (data) => {
            const origenLabels = { WEB:'🌐 Web', TELEFONO:'📞 Teléfono', WHATSAPP:'💬 WhatsApp',
                BOOKING:'🏨 Booking', EXPEDIA:'✈️ Expedia', AIRBNB:'🏠 Airbnb', DIRECTO:'🚶 Directo' };
            const origenLabel = origenLabels[data.origen] || data.origen || '📋';
            const esPendiente = data.estado === 'PENDIENTE';

            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: esPendiente ? '📅 Reserva pendiente de confirmar' : `📅 Nueva reserva recibida`,
                    html: `<b>${data.nombre}</b><br><span style="font-size:.85rem;color:#718096">${origenLabel} · ${data.tipo || ''}<br>Llegada: ${data.llegada || ''}</span>`,
                    icon: esPendiente ? 'warning' : 'info',
                    timer: 8000, timerProgressBar: true,
                    position: 'top-end', toast: true, showConfirmButton: false
                });
            }

            if (window.ReservasModule && typeof window.ReservasModule.cargarReservas === 'function') {
                window.ReservasModule.cargarReservas();
            }

            const alertsList = document.getElementById('dash-alerts-list');
            if (alertsList) {
                const spinner = alertsList.querySelector('.fa-spin');
                if (spinner) spinner.closest('div').remove();
                const item = document.createElement('div');
                item.className = `alert-item ${esPendiente ? 'warning' : 'info'}`;
                item.style.cursor = 'pointer';
                item.onclick = () => App.renderView('reservas', 'viewport');
                item.innerHTML = `<i class="fas fa-calendar-check" style="color:${esPendiente ? '#f39c12' : '#3498db'};font-size:1.2rem"></i>
                    <div><strong>${data.nombre}</strong>
                    <div style="font-size:.7rem;color:#718096">${origenLabel} · ${data.tipo || ''} · Llegada ${data.llegada || ''} · <code>${data.codigo}</code></div></div>`;
                alertsList.prepend(item);
            }
        });

        window.socket.on('cocina:pedido_pos', (data) => {
            window._pedidosPosDesktop.push(data);
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: `🔔 ${data.origen} — ROOM SERVICE`,
                    html: `<b>${data.nombreProducto}</b> &nbsp;x${data.cantidad}`,
                    icon: 'info', timer: 6000, timerProgressBar: true,
                    position: 'top-end', toast: true, showConfirmButton: false
                });
            }
            if (window.RestauranteModule && typeof window.RestauranteModule.renderPosDesktop === 'function') {
                window.RestauranteModule._pedidosPos = window._pedidosPosDesktop;
                window.RestauranteModule._pedidosPosEntregados = window._pedidosPosDesktopEntregados;
                const panel = document.getElementById('panel-cocina-desktop');
                if (panel && !panel.classList.contains('hidden')) {
                    window.RestauranteModule.renderPosDesktop();
                }
            }
        });
    },

    isSuperAdmin() {
        return this.user && parseInt(this.user.RolID) === 1;
    },

    async fetchSedes() {
        try {
            const res = await api.get('/admin/sedes');
            this.sedes = res.data;
        } catch (err) {
            console.error("Error cargando sedes para selector:", err);
        }
    },

    renderSedeSelector(containerId, callback) {
        const container = document.getElementById(containerId);
        
        // Si el contenedor no existe aún, reintentar en 50ms (Soluciona el lag del DOM)
        if (!container) {
            setTimeout(() => this.renderSedeSelector(containerId, callback), 50);
            return;
        }

        if (!this.isSuperAdmin() || this.sedes.length === 0) return;

        const currentSede = localStorage.getItem('currentSedeId') || (this.user ? this.user.SedeID : null);

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; min-width:200px;">
                <label style="font-size: 0.6rem; font-weight: 900; color: #718096; margin-left: 10px; margin-bottom: 5px; text-transform: uppercase;">Sede Operativa (Admin)</label>
                <select id="globalSedeSelector" class="input-neo" style="margin-bottom:0; height:45px; font-size:0.8rem;">
                    ${this.sedes.map(s => `
                        <option value="${s.SedeID}" ${s.SedeID == currentSede ? 'selected' : ''}>
                            ${s.NombreComercial.toUpperCase()}
                        </option>
                    `).join('')}
                </select>
            </div>
        `;

        const selector = document.getElementById('globalSedeSelector');
        selector.onchange = (e) => {
            const newSedeId = e.target.value;
            localStorage.setItem('currentSedeId', newSedeId);
            if (callback) callback(newSedeId);
        };
    },

    renderShell() {
        // ACTUALIZAR ESTADO DEL USUARIO DESDE STORAGE
        this.user = JSON.parse(localStorage.getItem('user'));

        // Solo crear socket si no existe — Socket.io maneja la reconexión internamente
        if (!window.socket) {
            this.conectarSocket();
        }

        document.getElementById('app-root').innerHTML = `
            <div class="app-wrapper" style="display:flex; height:100vh; background:#e0e0e4; font-family: 'Segoe UI', sans-serif; overflow:hidden;">
                <main style="flex:1; display:flex; flex-direction:column; overflow:hidden;">
                    <header class="topbar" style="height:75px; background:#e0e0e4; border-bottom:1px solid rgba(0,0,0,0.05); display:flex; align-items:center; justify-content:space-between; padding:0 35px; box-shadow: 0 4px 15px rgba(0,0,0,0.02); z-index:10;">
                        <div style="display:flex; align-items:center; gap:15px;">
                            <h2 style="color:#2c3e50; letter-spacing:3px; font-size:1.2rem; margin:0; font-weight:900;">
                                MASTERHOTEL <span style="color:#007bff; font-weight:300;">| CORE</span>
                            </h2>
                        </div>
                        <div style="display:flex; align-items:center; gap:25px;">
                            <div style="text-align:right;">
                                <p style="color:#2c3e50; font-size:0.9rem; margin:0; font-weight:800; letter-spacing:1px;">
                                    ${this.user && this.user.NombreFull ? this.user.NombreFull.toUpperCase() : 'USUARIO'}
                                </p>
                                <small style="color:#27ae60; font-size:0.7rem; font-weight:bold; text-transform:uppercase;">
                                    ${this.isSuperAdmin() ? 'ADMINISTRADOR GENERAL' : 'COLABORADOR'}
                                </small>
                            </div>
                            <div style="display:flex; align-items:center; gap:6px;" title="Estado de conexión con el servidor">
                                <span id="socket-status-indicator" style="width:10px; height:10px; border-radius:50%; background:#27ae60; display:inline-block; box-shadow:0 0 6px rgba(39,174,96,0.6); transition:background 0.3s;"></span>
                                <span style="font-size:0.65rem; color:#718096; font-weight:700;">SERVIDOR</span>
                            </div>
                            <button onclick="App.logout()"
                                style="background:#e0e0e4; color:#e74c3c; border:none; padding:10px 20px; border-radius:15px; cursor:pointer; font-size:0.75rem; font-weight:900; box-shadow: 4px 4px 8px #bebebe, -4px -4px 8px #ffffff;">
                                <i class="fas fa-power-off"></i> SALIR
                            </button>
                        </div>
                    </header>
                    <div id="viewport" style="flex:1; overflow-y:auto; background:#e0e0e4; position:relative;"></div>
                </main>
            </div>
        `;
        this.renderView('dashboard', 'viewport');
    },

    renderView(viewName, targetId) {
        try {
            const viewPath = path.join(__dirname, 'views', `${viewName}.html`);
            if (!fs.existsSync(viewPath)) throw new Error(`HTML no encontrado: ${viewPath}`);

            const html = fs.readFileSync(viewPath, 'utf8').replace(/^\uFEFF/, '');
            const target = document.getElementById(targetId);
            
            if (target) {
                target.innerHTML = html;
                // Delay para procesamiento del DOM
                setTimeout(() => this.loadModuleLogic(viewName), 10);
            }
        } catch (err) {
            console.error("Error en Navegación:", err.message);
        }
    },

    loadModuleLogic(name) {
        const modulePath = path.join(__dirname, 'modules', `${name}.js`);

        // Limpiar listeners del módulo anterior para evitar acumulación
        if (window.socket) {
            window.socket.off('habitacion:cambio');
            window.socket.off('mesa:cambio');
            window.socket.off('parqueadero:cambio');
            window.socket.off('producto:stock');
            window.socket.off('cocina:item_listo');
            window.socket.off('cocina:pedido_nuevo');
            window.socket.off('cocina:estado_cambio');
        }

        try {
            if (!fs.existsSync(modulePath)) return;

            // Limpia TODO el caché de modules/ (no solo el de la vista actual) — muchos
            // módulos de vista (facturacion.js, etc.) hacen require() de sub-módulos
            // propios (notascredito.js, retenciones.js, ...) que si no, quedan atascados
            // con código viejo aunque se renavegue a la vista contenedora.
            const modulesDir = path.join(__dirname, 'modules') + path.sep;
            Object.keys(require.cache).forEach(cachedPath => {
                if (cachedPath.startsWith(modulesDir)) delete require.cache[cachedPath];
            });

            const Module = require(modulePath);

            if (name === 'usuarios' || name === 'admin') {
                window.UsuariosModule = Module;
            } else {
                const globalName = name.charAt(0).toUpperCase() + name.slice(1) + 'Module';
                window[globalName] = Module;
            }

            if (Module && Module.init) {
                Module.init();
            }
        } catch (e) {
            console.error(`❌ CRÍTICO en módulo [${name}]:`, e);
        }
    },

    logout() {
        if(typeof Swal !== 'undefined') {
            Swal.fire({
                title: '¿SALIR DEL SISTEMA?',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'SÍ, SALIR',
                cancelButtonText: 'CANCELAR',
                background: '#e0e0e4',
                color: '#2c3e50'
            }).then((result) => { if (result.isConfirmed) this.clearSession(); });
        } else {
            if(confirm("¿Cerrar sesión?")) this.clearSession();
        }
    },

    clearSession() {
        localStorage.clear();
        window.location.reload();
    }
};

App.init();
window.App = App;